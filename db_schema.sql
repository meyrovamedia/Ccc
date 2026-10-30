-- RYVO Supabase PostgreSQL Database Schema, RLS Security Policies & Secure Atomic Order RPC
-- BOOTSTRAP SCRIPT FOR A FRESH PROJECT. Do not rerun this file over a live production schema.
-- Existing projects must be updated only with reviewed additive migrations; this file contains seed data.

-- ==========================================
-- 1. TABLES & CONSTRAINTS (Additive & Non-Destructive)
-- ==========================================

CREATE TABLE IF NOT EXISTS products (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(100) NOT NULL,
    price INTEGER NOT NULL CHECK (price >= 0),
    original_price INTEGER,
    image TEXT NOT NULL,
    badge VARCHAR(50),
    colors JSONB DEFAULT '[]'::jsonb,
    sizes JSONB DEFAULT '[]'::jsonb,
    description TEXT,
    rating NUMERIC(3,2) DEFAULT 5.0,
    reviews_count INTEGER DEFAULT 0,
    stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
    is_published BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Safe additive migration for existing tables if already created
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_published BOOLEAN DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS customers (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(50),
    orders_count INTEGER DEFAULT 0,
    total_spent INTEGER DEFAULT 0,
    status VARCHAR(50) DEFAULT 'Active',
    joined_date DATE DEFAULT CURRENT_DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS orders (
    id VARCHAR(50) PRIMARY KEY,
    customer_name VARCHAR(255) NOT NULL,
    customer_email VARCHAR(255) NOT NULL,
    customer_phone VARCHAR(50) NOT NULL,
    address TEXT NOT NULL,
    subtotal INTEGER NOT NULL CHECK (subtotal >= 0),
    shipping INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL CHECK (total >= 0),
    status VARCHAR(50) NOT NULL DEFAULT 'Confirmed',
    payment_method VARCHAR(50) NOT NULL,
    payment_status VARCHAR(50) NOT NULL DEFAULT 'Pending',
    tracking_number VARCHAR(100),
    gateway_order_id TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS gateway_order_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS orders_gateway_order_id_unique
    ON public.orders (gateway_order_id) WHERE gateway_order_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS order_items (
    id SERIAL PRIMARY KEY,
    order_id VARCHAR(50) REFERENCES orders(id) ON DELETE CASCADE,
    product_id VARCHAR(50) REFERENCES products(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    price INTEGER NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    size VARCHAR(20),
    color VARCHAR(50)
);

CREATE TABLE IF NOT EXISTS coupons (
    id VARCHAR(50) PRIMARY KEY,
    code VARCHAR(50) UNIQUE NOT NULL,
    discount_percent INTEGER NOT NULL CHECK (discount_percent > 0 AND discount_percent <= 100),
    min_order INTEGER DEFAULT 0,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS store_settings (
    key VARCHAR(100) PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_logs (
    id VARCHAR(50) PRIMARY KEY,
    admin VARCHAR(255) NOT NULL,
    action VARCHAR(255) NOT NULL,
    target TEXT,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==========================================
-- 2. ROW LEVEL SECURITY (RLS) & PERMISSIONS
-- ==========================================

ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_logs ENABLE ROW LEVEL SECURITY;

-- Revoke public default access
REVOKE ALL ON store_settings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON customers FROM PUBLIC, anon, authenticated;
REVOKE ALL ON orders FROM PUBLIC, anon, authenticated;
REVOKE ALL ON order_items FROM PUBLIC, anon, authenticated;
REVOKE ALL ON admin_logs FROM PUBLIC, anon, authenticated;

-- Drop existing policies
DROP POLICY IF EXISTS "Public Read Published Products" ON products;
DROP POLICY IF EXISTS "Public Read Active Coupons" ON coupons;
DROP POLICY IF EXISTS "No Public Store Settings Access" ON store_settings;

-- Public read policies (Strictly limited to published products & active coupons)
CREATE POLICY "Public Read Published Products" ON products FOR SELECT USING (is_published = true);
CREATE POLICY "Public Read Active Coupons" ON coupons FOR SELECT USING (active = true);

-- ==========================================
-- 3. SECURE ATOMIC ORDER & INVENTORY TRANSACTION RPC
-- ==========================================

-- Keep existing function overloads intact. Review and retire obsolete overloads in a separate migration only after auditing dependencies.

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
SET search_path = pg_catalog, public
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
    -- ==========================================
    -- 1. INPUT VALIDATION & LENGTH LIMITS
    -- ==========================================
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

    -- ==========================================
    -- 2. PARSE AND AGGREGATE ITEMS (HANDLE DUPLICATE PRODUCT IDS & VARIANTS)
    -- ==========================================
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

        -- Aggregate duplicate product_id, size, and color entries
        IF EXISTS (SELECT 1 FROM temp_order_items_parsed t WHERE t.product_id = v_product_id AND t.size = v_size AND t.color = v_color) THEN
            UPDATE temp_order_items_parsed 
            SET quantity = quantity + v_quantity 
            WHERE product_id = v_product_id AND size = v_size AND color = v_color;
        ELSE
            INSERT INTO temp_order_items_parsed (product_id, quantity, size, color)
            VALUES (v_product_id, v_quantity, v_size, v_color);
        END IF;
    END LOOP;

    -- ==========================================
    -- 3. CONCURRENCY: LOCK PRODUCTS IN DETERMINISTIC ORDER & VALIDATE STOCK / PUBLISHED STATUS
    -- ==========================================
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

        -- Authoritative price calculation
        v_calc_subtotal := v_calc_subtotal + (v_db_product.price * v_aggregated_item.quantity);
    END LOOP;

    -- ==========================================
    -- 4. CALCULATE SHIPPING & TOTAL FROM TRUSTED STORE CONFIG
    -- ==========================================
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

    -- ==========================================
    -- 5. INSERT ORDER & ORDER ITEMS, DECREMENT STOCK
    -- ==========================================
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
            v_aggregated_item.name,       -- Authoritative name from DB
            v_aggregated_item.price,      -- Authoritative price from DB
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

-- Secure Privileged RPC Permissions: Restrict execution strictly to service_role (trusted backend)
REVOKE EXECUTE ON FUNCTION public.create_order_atomic(VARCHAR, VARCHAR, VARCHAR, VARCHAR, TEXT, VARCHAR, VARCHAR, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_order_atomic(VARCHAR, VARCHAR, VARCHAR, VARCHAR, TEXT, VARCHAR, VARCHAR, JSONB) TO service_role;

-- Cancel a still-pending order and restore its reserved stock exactly once.
CREATE OR REPLACE FUNCTION public.cancel_pending_order_and_restore_stock(p_order_id VARCHAR(50))
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    UPDATE public.orders
       SET status = 'Cancelled', payment_status = 'Failed'
     WHERE id = p_order_id
       AND status = 'Pending'
       AND payment_status = 'Pending';

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'reason', 'order_not_pending_or_already_processed');
    END IF;

    UPDATE public.products AS p
       SET stock = p.stock + q.quantity
      FROM (
          SELECT product_id, SUM(quantity)::INTEGER AS quantity
            FROM public.order_items
           WHERE order_id = p_order_id AND product_id IS NOT NULL
           GROUP BY product_id
      ) AS q
     WHERE p.id = q.product_id;

    RETURN jsonb_build_object('success', true, 'order_id', p_order_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cancel_pending_order_and_restore_stock(VARCHAR) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_pending_order_and_restore_stock(VARCHAR) TO service_role;

-- ==========================================
-- 4. INITIAL SEED DATA
-- ==========================================

INSERT INTO store_settings (key, value) VALUES 
('config', '{
  "storeName": "RYVO",
  "tagline": "EVERYDAY, ELEVATED.",
  "supportEmail": "[SUPPORT EMAIL]",
  "supportPhone": "[SUPPORT PHONE]",
  "businessAddress": "[BUSINESS ADDRESS]",
  "legalBusinessName": "[LEGAL BUSINESS NAME]",
  "gstin": "[GSTIN]",
  "freeDeliveryThreshold": 3000,
  "standardShippingFee": 150,
  "returnWindowDays": 14,
  "grievanceOfficer": "[GRIEVANCE OFFICER]"
}'::jsonb)
ON CONFLICT (key) DO NOTHING;

INSERT INTO products (id, name, category, price, original_price, image, badge, colors, sizes, description, rating, reviews_count, stock, is_published) VALUES
('1', 'Oversized Utility Overshirt', 'Overshirts', 2790, 3490, '/src/assets/images/product_olive_overshirt_1793263932719.jpg', 'NEW', '["#556B2F", "#2F4F4F", "#A0522D", "#171717"]'::jsonb, '["XS", "S", "M", "L", "XL", "XXL"]'::jsonb, 'Crafted from heavy cotton twill with dual chest pockets and relaxed boxy drape. Designed for effortless layering across seasons.', 4.8, 42, 35, true),
('2', 'Essential Oversized T-Shirt', 'T-Shirts', 1490, NULL, '/src/assets/images/product_white_tshirt_1793263932650.jpg', 'BESTSELLER', '["#FFFFFF", "#F5F5DC", "#808080", "#171717", "#556B2F"]'::jsonb, '["XS", "S", "M", "L", "XL", "XXL"]'::jsonb, 'Ultra-heavyweight combed cotton with a structured ribbed collar. Pre-shrunk for the ultimate boxy silhouette.', 4.9, 128, 68, true),
('3', 'Premium Cotton Hoodie', 'T-Shirts', 2490, 2990, '/src/assets/images/product_gray_hoodie_1793263932585.jpg', NULL, '["#808080", "#171717", "#F5F5DC", "#A0522D"]'::jsonb, '["S", "M", "L", "XL", "XXL"]'::jsonb, 'Luxurious loopback fleece hoodie featuring double-layered hood and clean minimal pocketless front aesthetic.', 4.7, 89, 24, true),
('4', 'Relaxed Fit Linen Shirt', 'Shirts', 2490, NULL, '/src/assets/images/product_linen_shirt_1793263951479.jpg', NULL, '["#F5F5DC", "#FFFFFF", "#4682B4", "#171717"]'::jsonb, '["XS", "S", "M", "L", "XL"]'::jsonb, 'Breathable French linen button-down with Cuban collar. Impeccably soft with natural textured drape.', 4.6, 54, 45, true),
('5', 'Straight Fit Blue Jeans', 'Jeans', 2990, NULL, '/src/assets/images/product_blue_jeans_1793263951015.jpg', NULL, '["#4682B4", "#171717", "#708090"]'::jsonb, '["28", "30", "32", "34", "36", "38"]'::jsonb, 'Rigid Japanese selvedge denim washed to an authentic mid-blue vintage finish. Built to soften and mold to you over time.', 4.9, 96, 30, true),
('6', 'Casual Shirt', 'Shirts', 2290, NULL, '/src/assets/images/product_brown_shirt_1793263951705.jpg', NULL, '["#A0522D", "#556B2F", "#171717", "#F5F5DC"]'::jsonb, '["S", "M", "L", "XL", "XXL"]'::jsonb, 'Tencel-cotton blend shirt with horn buttons and a soft garment wash for lived-in comfort right from the first wear.', 4.5, 31, 19, true),
('7', 'Structured Wool-Blend Jacket', 'Jackets', 4990, NULL, '/src/assets/images/hero_rail_clothing_1793263932773.jpg', 'LIMITED', '["#171717", "#808080", "#A0522D"]'::jsonb, '["S", "M", "L", "XL"]'::jsonb, 'Clean-lined minimalist jacket in a warming wool blend. Features concealed button placket and structured collar.', 4.9, 18, 12, true),
('8', 'Pleated Tailored Trousers', 'Trousers', 2890, NULL, '/src/assets/images/hero_rail_clothing_1793263932773.jpg', NULL, '["#F5F5DC", "#171717", "#808080"]'::jsonb, '["28", "30", "32", "34", "36"]'::jsonb, 'High-waisted pleated trousers with a relaxed tapered leg. Crisp pressed crease and adjustable side tabs.', 4.7, 65, 28, true)
ON CONFLICT (id) DO NOTHING;
