import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '10mb', verify: (req, _res, buf) => { (req as any).rawBody = Buffer.from(buf); } }));

// Initialize Supabase Client if credentials are provided
const supabaseUrl = process.env.SUPABASE_URL || '';
// Server-side secret only. Never use a publishable/anon key for privileged server operations.
const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }) : null;
if (process.env.NODE_ENV === 'production' && !supabase) {
  throw new Error('Production requires SUPABASE_URL and SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY). Refusing to start with an in-memory database.');
}

if (supabase) {
  console.log('Connected to Supabase PostgreSQL database.');
} else {
  console.log('Running with fallback in-memory store (Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for persistence).');
}

// Fallback in-memory stores if Supabase is not configured
let memProducts = [
  {
    id: '1',
    name: 'Oversized Utility Overshirt',
    category: 'Overshirts',
    price: 2790,
    originalPrice: 3490,
    image: '/src/assets/images/product_olive_overshirt_1793263932719.jpg',
    badge: 'NEW',
    colors: ['#556B2F', '#2F4F4F', '#A0522D', '#171717'],
    sizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
    description: 'Crafted from heavy cotton twill with dual chest pockets and relaxed boxy drape. Designed for effortless layering across seasons.',
    rating: 4.8,
    reviewsCount: 42,
    stock: 35,
    isPublished: true
  },
  {
    id: '2',
    name: 'Essential Oversized T-Shirt',
    category: 'T-Shirts',
    price: 1490,
    image: '/src/assets/images/product_white_tshirt_1793263932650.jpg',
    badge: 'BESTSELLER',
    colors: ['#FFFFFF', '#F5F5DC', '#808080', '#171717', '#556B2F'],
    sizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
    description: 'Ultra-heavyweight combed cotton with a structured ribbed collar. Pre-shrunk for the ultimate boxy silhouette.',
    rating: 4.9,
    reviewsCount: 128,
    stock: 68,
    isPublished: true
  },
  {
    id: '3',
    name: 'Premium Cotton Hoodie',
    category: 'T-Shirts',
    price: 2490,
    originalPrice: 2990,
    image: '/src/assets/images/product_gray_hoodie_1793263932585.jpg',
    colors: ['#808080', '#171717', '#F5F5DC', '#A0522D'],
    sizes: ['S', 'M', 'L', 'XL', 'XXL'],
    description: 'Luxurious loopback fleece hoodie featuring double-layered hood and clean minimal pocketless front aesthetic.',
    rating: 4.7,
    reviewsCount: 89,
    stock: 24,
    isPublished: true
  },
  {
    id: '4',
    name: 'Relaxed Fit Linen Shirt',
    category: 'Shirts',
    price: 2490,
    image: '/src/assets/images/product_linen_shirt_1793263951479.jpg',
    colors: ['#F5F5DC', '#FFFFFF', '#4682B4', '#171717'],
    sizes: ['XS', 'S', 'M', 'L', 'XL'],
    description: 'Breathable French linen button-down with Cuban collar. Impeccably soft with natural textured drape.',
    rating: 4.6,
    reviewsCount: 54,
    stock: 45,
    isPublished: true
  },
  {
    id: '5',
    name: 'Straight Fit Blue Jeans',
    category: 'Jeans',
    price: 2990,
    image: '/src/assets/images/product_blue_jeans_1793263951015.jpg',
    colors: ['#4682B4', '#171717', '#708090'],
    sizes: ['28', '30', '32', '34', '36', '38'],
    description: 'Rigid Japanese selvedge denim washed to an authentic mid-blue vintage finish. Built to soften and mold to you over time.',
    rating: 4.9,
    reviewsCount: 96,
    stock: 30,
    isPublished: true
  },
  {
    id: '6',
    name: 'Casual Shirt',
    category: 'Shirts',
    price: 2290,
    image: '/src/assets/images/product_brown_shirt_1793263951705.jpg',
    colors: ['#A0522D', '#556B2F', '#171717', '#F5F5DC'],
    sizes: ['S', 'M', 'L', 'XL', 'XXL'],
    description: 'Tencel-cotton blend shirt with horn buttons and a soft garment wash for lived-in comfort right from the first wear.',
    rating: 4.5,
    reviewsCount: 31,
    stock: 19,
    isPublished: true
  },
  {
    id: '7',
    name: 'Structured Wool-Blend Jacket',
    category: 'Jackets',
    price: 4990,
    image: '/src/assets/images/hero_rail_clothing_1793263932773.jpg',
    badge: 'LIMITED',
    colors: ['#171717', '#808080', '#A0522D'],
    sizes: ['S', 'M', 'L', 'XL'],
    description: 'Clean-lined minimalist jacket in a warming wool blend. Features concealed button placket and structured collar.',
    rating: 4.9,
    reviewsCount: 18,
    stock: 12,
    isPublished: true
  },
  {
    id: '8',
    name: 'Pleated Tailored Trousers',
    category: 'Trousers',
    price: 2890,
    image: '/src/assets/images/hero_rail_clothing_1793263932773.jpg',
    colors: ['#F5F5DC', '#171717', '#808080'],
    sizes: ['28', '30', '32', '34', '36'],
    description: 'High-waisted pleated trousers with a relaxed tapered leg. Crisp pressed crease and adjustable side tabs.',
    rating: 4.7,
    reviewsCount: 65,
    stock: 28,
    isPublished: true
  }
];

let memOrders = [
  {
    id: 'ORD-98214',
    customerName: 'Aarav Sharma',
    customerEmail: 'aarav.sharma@example.com',
    customerPhone: '+91 98765 43210',
    address: 'Flat 402, Sterling Heights, Bandra West, Mumbai, 400050',
    items: [
      { productId: '1', name: 'Oversized Utility Overshirt', price: 2790, quantity: 1, size: 'M', color: '#556B2F' }
    ],
    subtotal: 2790,
    shipping: 0,
    total: 2790,
    status: 'Delivered',
    paymentMethod: 'COD',
    paymentStatus: 'Pending',
    createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
    trackingNumber: 'TRK-IN-889123'
  }
];

let memCustomers = [
  { id: 'CUST-1', name: 'Aarav Sharma', email: 'aarav.sharma@example.com', phone: '+91 98765 43210', ordersCount: 3, totalSpent: 8470, status: 'Active', joinedDate: '2026-01-15' }
];

let memCoupons = [
  { id: '1', code: 'NEXORA10', discountPercent: 10, minOrder: 1500, active: true },
  { id: '2', code: 'ELEVATED20', discountPercent: 20, minOrder: 3000, active: true }
];

let memSettings = {
  storeName: 'RYVO',
  tagline: 'EVERYDAY, ELEVATED.',
  supportEmail: '[SUPPORT EMAIL]',
  supportPhone: '[SUPPORT PHONE]',
  businessAddress: '[BUSINESS ADDRESS]',
  legalBusinessName: '[LEGAL BUSINESS NAME]',
  gstin: '[GSTIN]',
  freeDeliveryThreshold: 3000,
  standardShippingFee: 150,
  returnWindowDays: 14,
  grievanceOfficer: '[GRIEVANCE OFFICER]',
  heroTitle: 'EVERYDAY,\nELEVATED.',
  heroSubtitle: 'Timeless essentials. Modern silhouettes. Effortless style.',
  heroBadge: 'RYVO NEW COLLECTION',
  heroImage: '/src/assets/images/hero_rail_clothing_1793263932773.jpg',
  bestSellersTitle: 'FEATURED BESTSELLERS'
};

let memLogs = [
  { id: 'LOG-1', admin: 'system@ryvo.in', action: 'System Initialized', target: 'RYVO DB', timestamp: new Date().toISOString() }
];

// ==========================================
// STRICT FAIL-CLOSED ADMIN AUTHENTICATION MIDDLEWARE
// ==========================================
async function verifyAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!supabase) {
    return res.status(503).json({ error: 'Admin service is unavailable: Supabase server credentials are not configured.' });
  }

  const rawAdminEmails = process.env.ADMIN_EMAILS || '';
  const adminEmails = rawAdminEmails.split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  if (adminEmails.length === 0) {
    return res.status(503).json({ error: 'Admin access is not configured. Set ADMIN_EMAILS on the server.' });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing authentication token.' });
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) return res.status(401).json({ error: 'Unauthorized: Missing authentication token.' });

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or expired authentication token.' });
  }

  const userEmail = (user.email || '').trim().toLowerCase();
  if (!userEmail || !adminEmails.includes(userEmail)) {
    return res.status(403).json({ error: 'Forbidden: This account is not an approved administrator.' });
  }

  (req as any).user = user;
  next();
}

// ==========================================
// PUBLIC & PROTECTED API ROUTES
// ==========================================

app.get('/api/products', async (req, res) => {
  if (supabase) {
    const { data, error } = await supabase.from('products').select('*').eq('is_published', true).order('created_at', { ascending: false });
    if (!error && data) {
      const formatted = data.map((p: any) => ({
        id: p.id,
        name: p.name,
        category: p.category,
        price: p.price,
        originalPrice: p.original_price,
        image: p.image,
        badge: p.badge,
        colors: p.colors,
        sizes: p.sizes,
        description: p.description,
        rating: p.rating,
        reviewsCount: p.reviews_count,
        stock: p.stock,
        isPublished: p.is_published
      }));
      return res.json(formatted);
    }
  }
  res.json(memProducts.filter(p => p.isPublished !== false));
});

// Admin Product Mutation (Protected)
app.post('/api/products', verifyAdmin, async (req, res) => {
  const body = req.body;
  const newProduct = {
    id: Date.now().toString(),
    name: body.name,
    category: body.category,
    price: body.price,
    original_price: body.originalPrice || null,
    image: body.image,
    badge: body.badge || null,
    colors: body.colors || ['#171717'],
    sizes: body.sizes || ['S', 'M', 'L'],
    description: body.description,
    rating: 5.0,
    reviews_count: 0,
    stock: body.stock || 50,
    is_published: true
  };

  if (supabase) {
    const { error } = await supabase.from('products').insert([newProduct]);
    if (error) return res.status(500).json({ error: error.message });
  } else {
    memProducts.unshift({
      id: newProduct.id,
      name: newProduct.name,
      category: newProduct.category,
      price: newProduct.price,
      originalPrice: newProduct.original_price,
      image: newProduct.image,
      badge: newProduct.badge,
      colors: newProduct.colors,
      sizes: newProduct.sizes,
      description: newProduct.description,
      rating: 5.0,
      reviewsCount: 0,
      stock: newProduct.stock,
      isPublished: true
    });
  }
  res.status(201).json({ success: true, id: newProduct.id });
});

// Admin Product Deletion (Protected)
app.delete('/api/products/:id', verifyAdmin, async (req, res) => {
  const { id } = req.params;
  if (supabase) {
    await supabase.from('products').delete().eq('id', id);
  } else {
    memProducts = memProducts.filter(p => p.id !== id);
  }
  res.json({ success: true });
});

// Admin Product Stock Update (Protected)
app.put('/api/products/:id/stock', verifyAdmin, async (req, res) => {
  const { id } = req.params;
  const { stock } = req.body;
  const newStock = stock !== undefined ? Number(stock) : 0;
  if (supabase) {
    const { error } = await supabase.from('products').update({ stock: newStock }).eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
  } else {
    memProducts = memProducts.map(p => p.id === id ? { ...p, stock: newStock } : p);
  }
  res.json({ success: true });
});

// Admin Orders (Protected)
app.get('/api/orders', verifyAdmin, async (req, res) => {
  if (supabase) {
    const { data: ordersData, error } = await supabase.from('orders').select('*, order_items(*)').order('created_at', { ascending: false });
    if (!error && ordersData) {
      const formatted = ordersData.map((o: any) => ({
        id: o.id,
        customerName: o.customer_name,
        customerEmail: o.customer_email,
        customerPhone: o.customer_phone,
        address: o.address,
        items: o.order_items.map((i: any) => ({
          productId: i.product_id,
          name: i.name,
          price: i.price,
          quantity: i.quantity,
          size: i.size,
          color: i.color
        })),
        subtotal: o.subtotal,
        shipping: o.shipping,
        total: o.total,
        status: o.status,
        paymentMethod: o.payment_method,
        paymentStatus: o.payment_status,
        createdAt: o.created_at,
        trackingNumber: o.tracking_number
      }));
      return res.json(formatted);
    }
  }
  res.json(memOrders);
});

// Secure server-side validated order creation with Atomic PostgreSQL RPC
app.post('/api/orders', async (req, res) => {
  const { customerName, customerEmail, customerPhone, address, items, paymentMethod } = req.body;
  
  if (!customerName || !customerPhone || !address || !items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Invalid order payload or missing required fields.' });
  }

  let calculatedSubtotal = 0;
  const verifiedItems = [];

  for (const item of items) {
    let productPrice = item.product?.price || item.price || 0;
    let productName = item.product?.name || item.name || 'Product';
    let productId = item.product?.id || item.productId || '1';

    if (supabase) {
      const { data: dbProd } = await supabase.from('products').select('*').eq('id', productId).single();
      if (dbProd) {
        productPrice = dbProd.price; // Trusted database price
        productName = dbProd.name;
        if (dbProd.stock < item.quantity) {
          return res.status(400).json({ error: `Insufficient stock for ${dbProd.name}. Available: ${dbProd.stock}` });
        }
      }
    }

    calculatedSubtotal += productPrice * item.quantity;
    verifiedItems.push({
      product_id: productId,
      name: productName,
      price: productPrice,
      quantity: item.quantity,
      size: item.size || 'M',
      color: item.color || '#171717'
    });
  }

  const shipping = calculatedSubtotal >= 3000 ? 0 : 150;
  const total = calculatedSubtotal + shipping;
  const orderId = `ORD-${randomUUID().toUpperCase()}`;
  const trackingNumber = `TRK-IN-${randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`;
  const initialPaymentStatus = 'Pending';
  const famApiKey = process.env.FAMGATEWAY_API_KEY?.trim();
  const configuredSiteUrl = process.env.SITE_URL?.trim();
  let siteUrl = configuredSiteUrl || '';
  if (paymentMethod === 'online') {
    if (!supabase || !famApiKey || !configuredSiteUrl) {
      return res.status(503).json({ error: 'Online payments are unavailable until Supabase, FAMGATEWAY_API_KEY, and SITE_URL are configured. Please choose Cash on Delivery.' });
    }
    try {
      const parsedSiteUrl = new URL(configuredSiteUrl);
      const isLocalDevelopment = ['localhost', '127.0.0.1'].includes(parsedSiteUrl.hostname);
      if (parsedSiteUrl.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && isLocalDevelopment && parsedSiteUrl.protocol === 'http:')) {
        return res.status(503).json({ error: 'SITE_URL must use HTTPS for online payments.' });
      }
      siteUrl = parsedSiteUrl.origin;
    } catch {
      return res.status(503).json({ error: 'SITE_URL must be a valid absolute URL.' });
    }
  }

  let finalSubtotal = calculatedSubtotal;
  let finalShipping = shipping;
  let finalTotal = total;
  if (supabase) {
    // Execute atomic transaction via PostgreSQL RPC create_order_atomic
    const { data: rpcData, error: rpcErr } = await supabase.rpc('create_order_atomic', {
      p_order_id: orderId,
      p_customer_name: customerName,
      p_customer_email: customerEmail || 'guest@ryvo.in',
      p_customer_phone: customerPhone,
      p_address: address,
      p_payment_method: paymentMethod === 'online' ? 'Online (FamGateway)' : 'COD',
      p_tracking_number: trackingNumber,
      p_items: verifiedItems
    });

    if (rpcErr || !rpcData || rpcData.success !== true) {
      return res.status(500).json({ error: rpcErr?.message || 'Atomic transaction failed or insufficient stock.' });
    }
    finalSubtotal = Number(rpcData.subtotal);
    finalShipping = Number(rpcData.shipping);
    finalTotal = Number(rpcData.total);
  } else {
    // In-memory fallback
    const newOrder = {
      id: orderId,
      customerName,
      customerEmail: customerEmail || 'guest@ryvo.in',
      customerPhone,
      address,
      items: verifiedItems.map(vi => ({ productId: vi.product_id, name: vi.name, price: vi.price, quantity: vi.quantity, size: vi.size, color: vi.color })),
      subtotal: calculatedSubtotal,
      shipping,
      total,
      status: paymentMethod === 'online' ? 'Pending' : 'Confirmed',
      paymentMethod: paymentMethod === 'online' ? 'Online (FamGateway)' : 'COD',
      paymentStatus: initialPaymentStatus,
      createdAt: new Date().toISOString(),
      trackingNumber
    };
    memOrders.unshift(newOrder);
  }

  let checkoutUrl = null;

  if (paymentMethod === 'online') {
    if (famApiKey) {
      try {
        const fgRes = await fetch('https://famgateway.in/api/create-order', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Api-Key': famApiKey
          },
          body: JSON.stringify({
            amount: finalTotal,
            customer_name: customerName,
            redirect_url: `${siteUrl}?order_success=${orderId}`,
            webhook_url: `${siteUrl}/api/webhook/famgateway`
          })
        });
        const fgData = await fgRes.json();
        if (fgRes.ok && fgData && (fgData.status === 'success' || fgData.success) && (fgData.data?.checkout_url || fgData.checkout_url)) {
          const gatewayOrderId = fgData.data?.order_id || fgData.order_id;
          if (gatewayOrderId && supabase) {
            const { error: mapError } = await supabase.from('orders').update({ gateway_order_id: String(gatewayOrderId) }).eq('id', orderId);
            if (!mapError) checkoutUrl = fgData.data?.checkout_url || fgData.checkout_url;
            else console.error('Unable to store FamGateway order reference:', mapError.message);
          }
        }
      } catch (err) {
        console.error('FamGateway API error:', err);
      }
    }
    if (!checkoutUrl) {
      // The atomic order RPC reserves stock. If the gateway cannot create a session,
      // cancel through the database function that also restores reserved stock.
      const { data: cancelResult, error: cancelError } = await supabase!.rpc('cancel_pending_order_and_restore_stock', {
        p_order_id: orderId
      });
      if (cancelError || cancelResult?.success !== true) {
        console.error('Failed to cancel unpaid order and restore stock:', cancelError?.message || cancelResult);
      }
      return res.status(502).json({ error: 'FamGateway could not create a payment session. No payment has been confirmed; please retry later or choose Cash on Delivery.' });
    }
  }

  res.status(201).json({
    success: true,
    orderId,
    trackingNumber,
    total: finalTotal,
    checkoutUrl,
    message: paymentMethod === 'online' ? 'Order created. Proceeding to FamGateway payment.' : 'Order successfully placed (COD).'
  });
});

// FamGateway Webhook endpoint. Verify HMAC against the exact raw request bytes.
app.post('/api/webhook/famgateway', async (req, res) => {
  const apiKey = process.env.FAMGATEWAY_API_KEY;
  const signatureHeader = req.headers['x-famgateway-signature'];
  const rawBody: Buffer | undefined = (req as any).rawBody;
  if (!apiKey || typeof signatureHeader !== 'string' || !/^[a-f0-9]{64}$/i.test(signatureHeader) || !rawBody) {
    return res.status(401).json({ error: 'Missing or invalid webhook signature.' });
  }
  const expected = createHmac('sha256', apiKey).update(rawBody).digest();
  const supplied = Buffer.from(signatureHeader, 'hex');
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return res.status(401).json({ error: 'Invalid webhook signature.' });
  }

  const event = req.body || {};
  const gatewayOrderId = String(event.order_id || '');
  const eventStatus = String(event.status || event.event || '').toLowerCase();
  if (!gatewayOrderId) return res.status(400).json({ error: 'Missing gateway order reference.' });

  if (!supabase) return res.status(503).json({ error: 'Payment persistence is unavailable.' });
  const { data: order, error: findError } = await supabase.from('orders')
    .select('id,total,payment_status,status')
    .eq('gateway_order_id', gatewayOrderId)
    .maybeSingle();
  if (findError || !order) return res.status(404).json({ error: 'Order reference not found.' });

  const reportedAmount = Number(event.payable_amount ?? event.amount);
  if (!Number.isFinite(reportedAmount) || Math.round(reportedAmount * 100) !== Math.round(Number(order.total) * 100)) {
    return res.status(400).json({ error: 'Payment amount does not match the order total.' });
  }

  const isPaid = eventStatus === 'success' || eventStatus === 'successful' || eventStatus === 'paid' || eventStatus === 'payment.success';
  const nextPaymentStatus = isPaid ? 'Paid' : (eventStatus === 'expired' ? 'Failed' : 'Pending');
  const nextOrderStatus = isPaid ? 'Confirmed' : (nextPaymentStatus === 'Failed' ? 'Cancelled' : 'Pending');
  const { error: updateError } = await supabase.from('orders').update({
    payment_status: nextPaymentStatus,
    status: nextOrderStatus
  }).eq('id', order.id).eq('payment_status', 'Pending');
  if (updateError) return res.status(500).json({ error: 'Unable to update payment status.' });
  return res.json({ success: true, message: 'Verified payment event processed.' });
});

// Admin Order Status Update (Protected)
app.put('/api/orders/:id/status', verifyAdmin, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (supabase) {
    const { error } = await supabase.from('orders').update({ status }).eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
  } else {
    memOrders = memOrders.map(o => o.id === id ? { ...o, status } : o);
  }
  res.json({ success: true });
});

// Admin Customers (Protected)
app.get('/api/customers', verifyAdmin, async (req, res) => {
  if (supabase) {
    const { data } = await supabase.from('customers').select('*');
    if (data) return res.json(data);
  }
  res.json(memCustomers);
});

app.get('/api/coupons', async (req, res) => {
  if (supabase) {
    const { data } = await supabase.from('coupons').select('*').eq('active', true);
    if (data) {
      return res.json(data.map((c: any) => ({
        id: c.id,
        code: c.code,
        discountPercent: c.discount_percent,
        minOrder: c.min_order,
        active: c.active
      })));
    }
  }
  res.json(memCoupons);
});

// Full settings are available only to authenticated administrators.
app.get('/api/admin/settings', verifyAdmin, async (_req, res) => {
  if (!supabase) return res.status(503).json({ error: 'Settings persistence is unavailable.' });
  const { data, error } = await supabase.from('store_settings').select('value').eq('key', 'config').maybeSingle();
  if (error) return res.status(500).json({ error: 'Unable to load store settings.' });
  return res.json(data?.value || memSettings);
});

// Public Store Settings (Returns explicitly approved public fields + CMS banner/hero config)
app.get('/api/settings', async (req, res) => {
  if (supabase) {
    const { data } = await supabase.from('store_settings').select('value').eq('key', 'config').single();
    if (data && data.value) {
      const cfg = data.value;
      return res.json({
        storeName: cfg.storeName || memSettings.storeName,
        tagline: cfg.tagline || memSettings.tagline,
        supportEmail: cfg.supportEmail || memSettings.supportEmail,
        supportPhone: cfg.supportPhone || memSettings.supportPhone,
        businessAddress: cfg.businessAddress || memSettings.businessAddress,
        freeDeliveryThreshold: cfg.freeDeliveryThreshold ?? memSettings.freeDeliveryThreshold,
        standardShippingFee: cfg.standardShippingFee ?? memSettings.standardShippingFee,
        returnWindowDays: cfg.returnWindowDays ?? memSettings.returnWindowDays,
        heroTitle: cfg.heroTitle || memSettings.heroTitle,
        heroSubtitle: cfg.heroSubtitle || memSettings.heroSubtitle,
        heroBadge: cfg.heroBadge || memSettings.heroBadge,
        heroImage: cfg.heroImage || memSettings.heroImage,
        bestSellersTitle: cfg.bestSellersTitle || memSettings.bestSellersTitle
      });
    }
  }
  return res.json({
    storeName: memSettings.storeName, tagline: memSettings.tagline,
    supportEmail: memSettings.supportEmail, supportPhone: memSettings.supportPhone,
    businessAddress: memSettings.businessAddress, freeDeliveryThreshold: memSettings.freeDeliveryThreshold,
    standardShippingFee: memSettings.standardShippingFee, returnWindowDays: memSettings.returnWindowDays,
    heroTitle: memSettings.heroTitle, heroSubtitle: memSettings.heroSubtitle, heroBadge: memSettings.heroBadge,
    heroImage: memSettings.heroImage, bestSellersTitle: memSettings.bestSellersTitle
  });
});

// Admin Settings Update (Protected)
app.put('/api/settings', verifyAdmin, async (req, res) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({ error: 'Settings payload must be a JSON object.' });
  }
  if (supabase) {
    const { data: current, error: readError } = await supabase.from('store_settings').select('value').eq('key', 'config').maybeSingle();
    if (readError) return res.status(500).json({ error: 'Unable to load existing settings.' });
    const mergedConfig = { ...(current?.value || {}), ...req.body };
    const { error: writeError } = await supabase.from('store_settings').upsert({ key: 'config', value: mergedConfig });
    if (writeError) return res.status(500).json({ error: 'Unable to save store settings.' });
  } else {
    memSettings = { ...memSettings, ...req.body };
  }
  res.json({ success: true });
});

// Admin Logs (Protected)
app.get('/api/logs', verifyAdmin, async (req, res) => {
  if (supabase) {
    const { data } = await supabase.from('admin_logs').select('*').order('timestamp', { ascending: false });
    if (data) return res.json(data);
  }
  res.json(memLogs);
});

// Admin Analytics (Protected)
app.get('/api/analytics', verifyAdmin, async (req, res) => {
  let ordersList: any[] = memOrders;
  let productsList: any[] = memProducts;

  if (supabase) {
    const { data: ords } = await supabase.from('orders').select('*');
    if (ords) ordersList = ords.map((o: any) => ({ total: o.total, status: o.status }));
    const { data: prods } = await supabase.from('products').select('*');
    if (prods) productsList = prods.map((p: any) => ({ stock: p.stock }));
  }

  const totalOrders = ordersList.length;
  const grossSales = ordersList.reduce((sum: number, o: any) => sum + o.total, 0);
  const pendingOrders = ordersList.filter((o: any) => o.status === 'Confirmed' || o.status === 'Pending').length;
  const shippedOrders = ordersList.filter((o: any) => o.status === 'Shipped').length;
  const deliveredOrders = ordersList.filter((o: any) => o.status === 'Delivered').length;
  const lowStockProducts = productsList.filter((p: any) => p.stock < 20).length;

  res.json({
    totalOrders,
    grossSales,
    netSales: Math.round(grossSales * 0.82),
    pendingOrders,
    shippedOrders,
    deliveredOrders,
    lowStockProducts,
    totalProducts: productsList.length,
    totalCustomers: memCustomers.length
  });
});

// Vite middleware integration
if (process.env.NODE_ENV !== 'production') {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    server: { middlewareMode: true, hmr: process.env.DISABLE_HMR !== 'true' }
  });
  app.use(vite.middlewares);
} else {
  const distPath = path.resolve(__dirname, 'dist');
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    res.sendFile(path.resolve(distPath, 'index.html'));
  });
}

const PORT = 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`RYVO server running on http://0.0.0.0:${PORT}`);
});
