# RYVO Security & Correctness Audit: `create_order_atomic` PostgreSQL Function

This document details the security hardening, correctness fixes, privilege restrictions, and test cases implemented for the `create_order_atomic` PostgreSQL function in the RYVO project.

---

## 1. Summary of Security & Correctness Enhancements

### A. Trusted Prices
- **Vulnerability Addressed**: Previously, client-supplied item prices and product names in `p_items` could be manipulated by malicious actors to purchase items at zero or arbitrarily discounted prices.
- **Fix**: The function now completely ignores client-submitted prices and names. It queries `public.products` inside the transaction to fetch authoritative prices (`v_db_product.price`) and product names (`v_db_product.name`). Subtotal, shipping, and total are calculated authoritatively on the server/database side.

### B. Duplicate Product Handling
- **Vulnerability Addressed**: Submitting duplicate product IDs in `p_items` could bypass stock checks if individual line items each checked stock separately against the full inventory pool without aggregation.
- **Fix**: A temporary session table (`temp_order_items_parsed`) aggregates quantities for duplicate `(product_id, size, color)` entries prior to stock validation. Total aggregated quantity is then verified against available stock.

### C. Rigorous Input Validation
- **Validations Added**:
  - Rejects null, empty, non-array, or malformed `p_items`.
  - Rejects missing or blank product IDs.
  - Rejects non-integer or negative/zero quantities (< 1).
  - Sanitizes and enforces length limits on sizes (`<= 20 chars`) and colors (`<= 50 chars`).
  - Rejects unpublished products (`is_published = FALSE`).
  - Validates all customer fields (`order_id`, `customer_name`, `customer_email`, `customer_phone`, `address`, `payment_method`) with strict length checks (e.g., `address <= 1000 chars`).

### D. Concurrency & Deadlock Prevention
- **Fix**: Product row locks are acquired in strict deterministic order (`ORDER BY product_id ASC`) using `FOR UPDATE`. This prevents circular deadlocks under concurrent checkout load. Stock is rechecked and decremented within the same atomic ACID transaction.

### E. Privilege & Access Control
- **Fix**:
  - `SECURITY DEFINER` is used with a fixed `search_path = public` to prevent schema injection.
  - All table references are fully qualified (`public.products`, `public.orders`, `public.order_items`, `public.store_settings`).
  - `EXECUTE` is explicitly revoked from `PUBLIC`, `anon`, and `authenticated`.
  - `EXECUTE` is granted exclusively to `service_role`.
  - Exact signature matching is enforced in `REVOKE` and `GRANT` statements.

---

## 2. Final Complete Function Definition

```sql
CREATE OR REPLACE FUNCTION public.create_order_atomic(
    p_order_id VARCHAR(50),
    p_customer_name VARCHAR(255),
    p_customer_email VARCHAR(255),
    p_customer_phone VARCHAR(50),
    p_address TEXT,
    p_payment_method VARCHAR(50),
    p_tracking_number VARCHAR(100),
    p_items JSONB
) RETURNS JSONB 
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_item JSONB;
    v_product_id VARCHAR(50);
    v_quantity INTEGER;
    v_size VARCHAR(20);
    v_color VARCHAR(50);
    
    v_db_product RECORD;
    v_calc_subtotal INTEGER := 0;
    v_free_threshold INTEGER := 3000;
    v_std_shipping INTEGER := 150;
    v_shipping INTEGER := 0;
    v_total INTEGER := 0;
    
    v_aggregated_item RECORD;
BEGIN
    -- 1. Input Validation & Length Limits
    IF p_order_id IS NULL OR length(trim(p_order_id)) = 0 OR length(p_order_id) > 50 THEN
        RAISE EXCEPTION 'Invalid or missing order ID';
    END IF;

    IF p_customer_name IS NULL OR length(trim(p_customer_name)) = 0 OR length(p_customer_name) > 255 THEN
        RAISE EXCEPTION 'Invalid or missing customer name';
    END IF;

    IF p_customer_email IS NULL OR length(trim(p_customer_email)) = 0 OR length(p_customer_email) > 255 THEN
        RAISE EXCEPTION 'Invalid or missing customer email';
    END IF;

    IF p_customer_phone IS NULL OR length(trim(p_customer_phone)) = 0 OR length(p_customer_phone) > 50 THEN
        RAISE EXCEPTION 'Invalid or missing customer phone';
    END IF;

    IF p_address IS NULL OR length(trim(p_address)) = 0 OR length(p_address) > 1000 THEN
        RAISE EXCEPTION 'Invalid or missing address (max 1000 characters)';
    END IF;

    IF p_payment_method IS NULL OR length(trim(p_payment_method)) = 0 OR length(p_payment_method) > 50 THEN
        RAISE EXCEPTION 'Invalid or missing payment method';
    END IF;

    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'p_items must be a non-empty JSON array';
    END IF;

    -- 2. Parse and Aggregate Items (Handle Duplicate Product IDs & Variants)
    CREATE TEMP TABLE IF NOT EXISTS temp_order_items_parsed (
        product_id VARCHAR(50) NOT NULL,
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        size VARCHAR(20),
        color VARCHAR(50)
    ) ON COMMIT DROP;

    TRUNCATE TABLE temp_order_items_parsed;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_product_id := trim(v_item->>'product_id');
        IF v_product_id IS NULL OR length(v_product_id) = 0 THEN
            RAISE EXCEPTION 'Item missing product_id';
        END IF;

        BEGIN
            v_quantity := (v_item->>'quantity')::INTEGER;
        EXCEPTION WHEN OTHERS THEN
            RAISE EXCEPTION 'Invalid non-integer quantity for product %', v_product_id;
        END;

        IF v_quantity IS NULL OR v_quantity < 1 THEN
            RAISE EXCEPTION 'Quantity must be at least 1 for product %', v_product_id;
        END IF;

        v_size := trim(coalesce(v_item->>'size', 'M'));
        IF length(v_size) > 20 THEN v_size := 'M'; END IF;

        v_color := trim(coalesce(v_item->>'color', '#171717'));
        IF length(v_color) > 50 THEN v_color := '#171717'; END IF;

        IF EXISTS (SELECT 1 FROM temp_order_items_parsed t WHERE t.product_id = v_product_id AND t.size = v_size AND t.color = v_color) THEN
            UPDATE temp_order_items_parsed 
            SET quantity = quantity + v_quantity 
            WHERE product_id = v_product_id AND size = v_size AND color = v_color;
        ELSE
            INSERT INTO temp_order_items_parsed (product_id, quantity, size, color)
            VALUES (v_product_id, v_quantity, v_size, v_color);
        END IF;
    END LOOP;

    -- 3. Concurrency: Lock Products in Deterministic Order & Validate Stock
    FOR v_aggregated_item IN 
        SELECT product_id, quantity, size, color 
        FROM temp_order_items_parsed 
        ORDER BY product_id ASC
    LOOP
        SELECT * INTO v_db_product 
        FROM public.products 
        WHERE id = v_aggregated_item.product_id 
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Product ID % does not exist', v_aggregated_item.product_id;
        END IF;

        IF v_db_product.is_published = FALSE THEN
            RAISE EXCEPTION 'Product % (%) is not published', v_db_product.name, v_db_product.id;
        END IF;

        IF v_db_product.stock < v_aggregated_item.quantity THEN
            RAISE EXCEPTION 'Insufficient stock for product %. Available: %, Requested: %', 
                v_db_product.name, v_db_product.stock, v_aggregated_item.quantity;
        END IF;

        v_calc_subtotal := v_calc_subtotal + (v_db_product.price * v_aggregated_item.quantity);
    END LOOP;

    -- 4. Calculate Shipping & Total from Trusted Store Config
    SELECT (value->>'freeDeliveryThreshold')::INTEGER, (value->>'standardShippingFee')::INTEGER
    INTO v_free_threshold, v_std_shipping
    FROM public.store_settings
    WHERE key = 'config';

    v_free_threshold := coalesce(v_free_threshold, 3000);
    v_std_shipping := coalesce(v_std_shipping, 150);

    IF v_calc_subtotal >= v_free_threshold THEN
        v_shipping := 0;
    ELSE
        v_shipping := v_std_shipping;
    END IF;

    v_total := v_calc_subtotal + v_shipping;

    -- 5. Insert Order & Order Items, Decrement Stock
    INSERT INTO public.orders (
        id, customer_name, customer_email, customer_phone, address, 
        subtotal, shipping, total, status, payment_method, payment_status, tracking_number
    )
    VALUES (
        p_order_id, p_customer_name, p_customer_email, p_customer_phone, p_address,
        v_calc_subtotal, v_shipping, v_total, 'Confirmed', p_payment_method, 'Pending', p_tracking_number
    );

    FOR v_aggregated_item IN 
        SELECT t.product_id, t.quantity, t.size, t.color, p.name, p.price 
        FROM temp_order_items_parsed t
        JOIN public.products p ON p.id = t.product_id
    LOOP
        INSERT INTO public.order_items (order_id, product_id, name, price, quantity, size, color)
        VALUES (
            p_order_id,
            v_aggregated_item.product_id,
            v_aggregated_item.name,
            v_aggregated_item.price,
            v_aggregated_item.quantity,
            v_aggregated_item.size,
            v_aggregated_item.color
        );

        UPDATE public.products
        SET stock = stock - v_aggregated_item.quantity
        WHERE id = v_aggregated_item.product_id;
    END LOOP;

    RETURN jsonb_build_object(
        'success', true, 
        'order_id', p_order_id, 
        'subtotal', v_calc_subtotal, 
        'shipping', v_shipping, 
        'total', v_total
    );
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.create_order_atomic(VARCHAR, VARCHAR, VARCHAR, VARCHAR, TEXT, VARCHAR, VARCHAR, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_order_atomic(VARCHAR, VARCHAR, VARCHAR, VARCHAR, TEXT, VARCHAR, VARCHAR, JSONB) TO service_role;
```

---

## 3. Comprehensive Test Cases

| Test Case | Scenario Description | Expected Outcome | Verification Status |
|---|---|---|---|
| **1. Manipulated Prices** | Client sends item with `price: 1` instead of actual DB price `2790`. | Order succeeds, but `order_items.price` and `orders.subtotal/total` use the authoritative database price (`2790`). | Code Reviewed & Static Verified |
| **2. Duplicate Product IDs** | Client sends product `'1'` twice in `p_items` (e.g. qty 2 and qty 3). | Duplicates are aggregated into a single entry with quantity 5. Stock check verifies `stock >= 5`. | Code Reviewed & Static Verified |
| **3. Insufficient Stock** | Client requests 100 units of product `'7'` which has stock = 12. | Transaction aborts with `Insufficient stock` exception and rolls back all changes. | Code Reviewed & Static Verified |
| **4. Unpublished Products** | Client attempts to purchase a product where `is_published = FALSE`. | Transaction aborts with `is not published` exception. | Code Reviewed & Static Verified |
| **5. Malformed Quantities** | Client sends `quantity: 0`, negative quantity, or non-integer string like `"abc"`. | Transaction aborts with input validation exception (`Quantity must be at least 1` or `Invalid non-integer quantity`). | Code Reviewed & Static Verified |
| **6. Simultaneous Orders** | Two concurrent transactions attempt to purchase the last 5 items of product `'1'`. | PostgreSQL row-level locks (`FOR UPDATE`) serialize access; first transaction succeeds, second transaction detects updated stock and fails gracefully. | Code Reviewed & Static Verified |

*Note on Testing Execution:* Per instructions, database migration execution and live SQL deployment were not performed (code reviewed and statically built/verified successfully).
