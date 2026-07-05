require('dotenv').config();
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const mongoose = require('mongoose');
const path = require('path');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const moment = require('moment');
const { Business, User, Category, Product, Supplier, Customer, Purchase, Sale, Expense, StockAdjustment, Attendance, Notification, ActivityLog } = require('./models');

// ==========================================
// MONGODB CONNECTION & STRICT ERROR CHECK
// ==========================================
if (!process.env.MONGODB_URI) {
    console.error("ERROR: MONGODB_URI is missing.");
    console.error("You must set the MONGODB_URI environment variable in Render.com or your .env file.");
    process.exit(1);
}

mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('✅ Connected to MongoDB'))
    .catch(err => {
        console.error('❌ MongoDB Connection Error:', err.message);
        process.exit(1);
    });

// ==========================================
// EXPRESS APP CONFIGURATION
// ==========================================
const app = express();
const PORT = process.env.PORT || 3000;

// View Engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Static Assets
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Session Configuration (connect-mongo for persistence)
app.use(session({
    secret: process.env.SESSION_SECRET || 'fallback_secret_change_me',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: process.env.MONGODB_URI, collectionName: 'sessions' }),
    cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));

// Rate Limiter for Login
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // Limit each IP to 10 requests per windowMs
    message: "Too many login attempts, please try again after 15 minutes."
});

// Multer Setup for File Uploads
const storage = multer.diskStorage({
    destination: './public/uploads/',
    filename: (req, file, cb) => {
        cb(null, `IMG-${Date.now()}${path.extname(file.originalname)}`);
    }
});
const upload = multer({ storage });

// ==========================================
// GLOBAL MIDDLEWARE
// ==========================================

// Authentication Guard
const isAuthenticated = (req, res, next) => {
    if (req.session.userId) return next();
    res.redirect('/login');
};

// Role-Based Access Control
const hasRole = (...roles) => {
    return (req, res, next) => {
        if (roles.includes(req.session.userRole)) return next();
        res.status(403).send('Access Denied: Insufficient permissions.');
    };
};

// Multi-Tenant Data Scoping
const attachBusinessContext = (req, res, next) => {
    req.business_id = req.session.businessId;
    if (!req.business_id) return res.redirect('/login');
    next();
};

// Helper: Format Currency to BDT
const formatBDT = (amount) => {
    return '৳' + Number(amount || 0).toLocaleString('en-BD', { minimumFractionDigits: 2 });
};

// Make helpers available in EJS
app.use((req, res, next) => {
    res.locals.formatBDT = formatBDT;
    res.locals.moment = moment;
    res.locals.user = req.session.userName || null;
    res.locals.role = req.session.userRole || null;
    res.locals.success_msg = req.session.success_msg || null;
    res.locals.error_msg = req.session.error_msg || null;
    next();
    // Clear flash messages after they are exposed to views
    req.session.success_msg = null;
    req.session.error_msg = null;
});

// ==========================================
// AUTHENTICATION ROUTES
// ==========================================

// Signup Page & Logic
app.get('/signup', (req, res) => {
    if (req.session.userId) return res.redirect('/dashboard');
    res.render('signup', { error: null });
});

app.post('/signup', async (req, res) => {
    try {
        const { businessName, ownerName, email, phone, password, tradeLicense } = req.body;
        let existingUser = await User.findOne({ email });
        if (existingUser) return res.render('signup', { error: 'Email already registered' });

        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Create Business
        const business = new Business({
            name: businessName, phone, trade_license_no: tradeLicense, subscription_plan: 'free'
        });
        await business.save();

        // Create Owner User
        const user = new User({
            full_name: ownerName, email, phone, password: hashedPassword,
            role: 'owner', business_id: business._id
        });
        await user.save();

        business.owner_id = user._id;
        await business.save();

        req.session.success_msg = 'Account created! Please login.';
        res.redirect('/login');
    } catch (err) {
        res.render('signup', { error: err.message });
    }
});

// Login Page & Logic
app.get('/login', (req, res) => {
    if (req.session.userId) return res.redirect('/dashboard');
    res.render('login', { error: null });
});

app.post('/login', loginLimiter, async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email }).populate('business_id');
        if (!user) return res.render('login', { error: 'Invalid email or password' });
        if (!user.is_active) return res.render('login', { error: 'Account deactivated. Contact owner.' });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.render('login', { error: 'Invalid email or password' });

        // Set Session
        req.session.userId = user._id;
        req.session.businessId = user.business_id._id;
        req.session.userName = user.full_name;
        req.session.userRole = user.role;

        user.last_login = new Date();
        await user.save();

        res.redirect('/dashboard');
    } catch (err) {
        res.render('login', { error: 'Server error' });
    }
});

// Logout
app.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) console.error(err);
        res.redirect('/login');
    });
});

// ==========================================
// DASHBOARD ROUTES
// ==========================================
app.get('/dashboard', isAuthenticated, attachBusinessContext, async (req, res) => {
    try {
        const todayStart = moment().startOf('day').toDate();
        const todayEnd = moment().endOf('day').toDate();

        const todaySales = await Sale.aggregate([
            { $match: { business_id: new mongoose.Types.ObjectId(req.business_id), created_at: { $gte: todayStart, $lte: todayEnd }, status: 'completed' } },
            { $group: { _id: null, total: { $sum: "$grand_total" }, count: { $sum: 1 } } }
        ]);

        const totalDue = await Customer.aggregate([
            { $match: { business_id: new mongoose.Types.ObjectId(req.business_id) } },
            { $group: { _id: null, total: { $sum: "$due_amount" } } }
        ]);

        const lowStockCount = await Product.countDocuments({ business_id: req.business_id, stock_qty: { $lte: { $cond: { if: { $gt: ["$low_stock_alert_qty", 0] }, then: "$low_stock_alert_qty", else: 5 } } } });
        // Simplified low stock count for robustness:
        const lowStockProducts = await Product.find({ business_id: req.business_id, $expr: { $lte: ["$stock_qty", "$low_stock_alert_qty"] } });
        
        // Sales trend for last 7 days
        const salesTrend = await Sale.aggregate([
            { $match: { business_id: new mongoose.Types.ObjectId(req.business_id), created_at: { $gte: moment().subtract(7, 'days').toDate() }, status: 'completed' } },
            { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$created_at" } }, total: { $sum: "$grand_total" } } },
            { $sort: { _id: 1 } }
        ]);

        const notifications = await Notification.find({ business_id: req.business_id, is_read: false }).sort({ created_at: -1 }).limit(5);

        res.render('dashboard', {
            todaySalesTotal: todaySales[0]?.total || 0,
            todayTxCount: todaySales[0]?.count || 0,
            totalDueAmount: totalDue[0]?.total || 0,
            lowStockCount: lowStockProducts.length,
            salesTrend: JSON.stringify(salesTrend),
            notifications
        });
    } catch (err) {
        res.status(500).send(err.message);
    }
});

// ==========================================
// CATEGORY ROUTES
// ==========================================
app.get('/categories', isAuthenticated, attachBusinessContext, hasRole('owner', 'admin', 'manager'), async (req, res) => {
    const categories = await Category.find({ business_id: req.business_id }).populate('parent_category_id');
    res.render('categories', { categories });
});

app.post('/categories', isAuthenticated, attachBusinessContext, hasRole('owner', 'admin', 'manager'), async (req, res) => {
    try {
        const { name, parent_id } = req.body;
        await new Category({ name, business_id: req.business_id, parent_category_id: parent_id || null }).save();
        req.session.success_msg = "Category added";
        res.redirect('/categories');
    } catch (err) {
        req.session.error_msg = err.message;
        res.redirect('/categories');
    }
});

// ==========================================
// PRODUCT ROUTES
// ==========================================
app.get('/products', isAuthenticated, attachBusinessContext, async (req, res) => {
    const products = await Product.find({ business_id: req.business_id }).populate('category_id');
    const categories = await Category.find({ business_id: req.business_id });
    res.render('products', { products, categories });
});

app.post('/products', isAuthenticated, attachBusinessContext, hasRole('owner', 'admin', 'manager'), upload.single('product_image'), async (req, res) => {
    try {
        const { name, sku, barcode, category_id, unit, purchase_price, sale_price, stock_qty, low_stock_alert_qty } = req.body;
        const product_image = req.file ? `/uploads/${req.file.filename}` : '';
        
        await new Product({
            name, sku, barcode, category_id, unit, purchase_price, sale_price,
            stock_qty: Number(stock_qty), low_stock_alert_qty: Number(low_stock_alert_qty) || 5,
            product_image, business_id: req.business_id
        }).save();

        // Check low stock alert immediately
        if (Number(stock_qty) <= (Number(low_stock_alert_qty) || 5)) {
            await new Notification({
                business_id: req.business_id, type: 'low_stock',
                message: `${name} is low in stock (${stock_qty} left)`
            }).save();
        }

        req.session.success_msg = "Product added";
        res.redirect('/products');
    } catch (err) {
        req.session.error_msg = err.message;
        res.redirect('/products');
    }
});

// ==========================================
// CUSTOMER ROUTES
// ==========================================
app.get('/customers', isAuthenticated, attachBusinessContext, async (req, res) => {
    const customers = await Customer.find({ business_id: req.business_id }).sort({ name: 1 });
    res.render('customers', { customers });
});

app.post('/customers', isAuthenticated, attachBusinessContext, async (req, res) => {
    try {
        const { name, phone, address } = req.body;
        await new Customer({ name, phone, address, business_id: req.business_id }).save();
        req.session.success_msg = "Customer added";
        res.redirect('/customers');
    } catch (err) {
        req.session.error_msg = err.message;
        res.redirect('/customers');
    }
});

// ==========================================
// SUPPLIER ROUTES
// ==========================================
app.get('/suppliers', isAuthenticated, attachBusinessContext, async (req, res) => {
    const suppliers = await Supplier.find({ business_id: req.business_id }).sort({ name: 1 });
    res.render('suppliers', { suppliers });
});

app.post('/suppliers', isAuthenticated, attachBusinessContext, hasRole('owner', 'admin'), async (req, res) => {
    try {
        const { name, phone, address } = req.body;
        await new Supplier({ name, phone, address, business_id: req.business_id }).save();
        req.session.success_msg = "Supplier added";
        res.redirect('/suppliers');
    } catch (err) {
        req.session.error_msg = err.message;
        res.redirect('/suppliers');
    }
});

// ==========================================
// PURCHASE ROUTES
// ==========================================
app.get('/purchases', isAuthenticated, attachBusinessContext, async (req, res) => {
    const purchases = await Purchase.find({ business_id: req.business_id }).populate('supplier_id created_by').sort({ created_at: -1 });
    const suppliers = await Supplier.find({ business_id: req.business_id });
    const products = await Product.find({ business_id: req.business_id });
    res.render('purchases', { purchases, suppliers, products });
});

app.post('/purchases', isAuthenticated, attachBusinessContext, hasRole('owner', 'admin', 'manager'), async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const { supplier_id, items, paid_amount } = req.body;
        const itemArray = JSON.parse(items); // Expects [{product_id, qty, unit_price}]
        
        let totalAmount = 0;
        for (let item of itemArray) {
            totalAmount += item.qty * item.unit_price;
            // Increase Stock
            await Product.findByIdAndUpdate(item.product_id, { $inc: { stock_qty: item.qty } }, { session });
        }

        const dueAmount = totalAmount - Number(paid_amount);
        const paymentStatus = dueAmount <= 0 ? 'paid' : (paid_amount > 0 ? 'partial' : 'due');

        const purchase = new Purchase({
            supplier_id, business_id: req.business_id, items: itemArray,
            total_amount: totalAmount, paid_amount: Number(paid_amount),
            due_amount: dueAmount, payment_status, created_by: req.session.userId
        });
        await purchase.save({ session });

        // Update Supplier Due
        if (dueAmount > 0) {
            await Supplier.findByIdAndUpdate(supplier_id, { $inc: { due_amount: dueAmount } }, { session });
        }

        await session.commitTransaction();
        req.session.success_msg = "Purchase recorded & stock updated";
        res.redirect('/purchases');
    } catch (err) {
        await session.abortTransaction();
        req.session.error_msg = err.message;
        res.redirect('/purchases');
    } finally {
        session.endSession();
    }
});

// ==========================================
// POS TERMINAL ROUTES
// ==========================================
app.get('/pos', isAuthenticated, attachBusinessContext, async (req, res) => {
    const products = await Product.find({ business_id: req.business_id, is_active: true });
    const customers = await Customer.find({ business_id: req.business_id });
    // Get held sales for this user/session
    const heldSales = await Sale.find({ business_id: req.business_id, sold_by: req.session.userId, status: 'held' });
    res.render('pos', { products, customers, heldSales });
});

// Search API for POS
app.get('/api/products/search', isAuthenticated, attachBusinessContext, async (req, res) => {
    const query = req.query.q;
    const regex = new RegExp(query, 'i');
    const products = await Product.find({
        business_id: req.business_id, is_active: true,
        $or: [{ name: regex }, { barcode: query }, { sku: regex }]
    }).limit(10);
    res.json(products);
});

// Checkout API
app.post('/pos/checkout', isAuthenticated, attachBusinessContext, async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const { cart, customer_id, discount_total, vat_tax, paid_amount, payment_method, hold_sale_id } = req.body;
        
        let subtotal = 0;
        const saleItems = [];

        for (let item of cart) {
            const product = await Product.findById(item.product_id).session(session);
            if (product.stock_qty < item.qty) throw new Error(`Insufficient stock for ${product.name}`);
            
            subtotal += (item.qty * item.sale_price) - (item.discount || 0);
            saleItems.push({
                product_id: item.product_id, qty: item.qty,
                unit_price: item.sale_price, discount: item.discount || 0
            });
            
            // Decrease Stock
            product.stock_qty -= item.qty;
            if (product.stock_qty <= product.low_stock_alert_qty) {
                await new Notification({
                    business_id: req.business_id, type: 'low_stock',
                    message: `${product.name} is low in stock (${product.stock_qty} left)`
                }).save({ session });
            }
            await product.save({ session });
        }

        const vatAmount = Number(((subtotal - Number(discount_total)) * (Number(vat_tax)/100)).toFixed(2));
        const grandTotal = subtotal - Number(discount_total) + vatAmount;
        const dueAmount = grandTotal - Number(paid_amount);
        const paymentStatus = dueAmount <= 0 ? 'paid' : (paid_amount > 0 ? 'partial' : 'due');

        // Auto-increment Invoice No
        const lastSale = await Sale.findOne({ business_id: req.business_id }).sort({ created_at: -1 }).session(session);
        let invNo = 1;
        if (lastSale && lastSale.invoice_no) {
            invNo = parseInt(lastSale.invoice_no.split('-')[1]) + 1;
        }
        const invoice_no = `INV-${String(invNo).padStart(5, '0')}`;

        const saleData = {
            invoice_no, customer_id: customer_id || null, business_id: req.business_id,
            items: saleItems, subtotal, discount_total: Number(discount_total),
            vat_tax: vatAmount, grand_total: grandTotal, paid_amount: Number(paid_amount),
            due_amount: dueAmount, payment_method, payment_status,
            status: 'completed', sold_by: req.session.userId
        };

        let sale;
        if (hold_sale_id) {
            // Resume and complete held sale
            sale = await Sale.findByIdAndUpdate(hold_sale_id, saleData, { new: true, session });
        } else {
            sale = new Sale(saleData);
            await sale.save({ session });
        }

        // Update Customer Due
        if (customer_id && dueAmount > 0) {
            await Customer.findByIdAndUpdate(customer_id, { $inc: { due_amount: dueAmount } }, { session });
        }

        await session.commitTransaction();
        res.json({ success: true, invoice_no: sale.invoice_no, sale_id: sale._id });

    } catch (err) {
        await session.abortTransaction();
        res.status(400).json({ success: false, message: err.message });
    } finally {
        session.endSession();
    }
});

// Hold Sale API
app.post('/pos/hold', isAuthenticated, attachBusinessContext, async (req, res) => {
    try {
        const { cart, customer_id } = req.body;
        let subtotal = 0;
        const saleItems = cart.map(item => {
            subtotal += (item.qty * item.sale_price);
            return { product_id: item.product_id, qty: item.qty, unit_price: item.sale_price, discount: 0 };
        });

        const sale = new Sale({
            invoice_no: `HELD-${Date.now()}`, customer_id, business_id: req.business_id,
            items: saleItems, subtotal, grand_total: subtotal, status: 'held', sold_by: req.session.userId
        });
        await sale.save();
        res.json({ success: true, message: "Sale parked" });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

// ==========================================
// EXPENSE ROUTES
// ==========================================
app.get('/expenses', isAuthenticated, attachBusinessContext, async (req, res) => {
    const expenses = await Expense.find({ business_id: req.business_id }).populate('created_by').sort({ created_at: -1 });
    res.render('expenses', { expenses });
});

app.post('/expenses', isAuthenticated, attachBusinessContext, async (req, res) => {
    try {
        const { category, amount, note } = req.body;
        await new Expense({ business_id: req.business_id, category, amount, note, created_by: req.session.userId }).save();
        req.session.success_msg = "Expense added";
        res.redirect('/expenses');
    } catch (err) {
        req.session.error_msg = err.message;
        res.redirect('/expenses');
    }
});

// ==========================================
// STAFF & ATTENDANCE ROUTES
// ==========================================
app.get('/staff', isAuthenticated, attachBusinessContext, hasRole('owner', 'admin'), async (req, res) => {
    const staff = await User.find({ business_id: req.business_id, role: { $ne: 'owner' } });
    res.render('staff', { staff });
});

app.post('/staff', isAuthenticated, attachBusinessContext, hasRole('owner'), async (req, res) => {
    try {
        const { full_name, email, phone, password, role } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        await new User({ full_name, email, phone, password: hashedPassword, role, business_id: req.business_id }).save();
        req.session.success_msg = "Staff added";
        res.redirect('/staff');
    } catch (err) {
        req.session.error_msg = err.message;
        res.redirect('/staff');
    }
});

app.get('/attendance', isAuthenticated, attachBusinessContext, async (req, res) => {
    const today = moment().format('YYYY-MM-DD');
    const records = await Attendance.find({ business_id: req.business_id, date: today }).populate('user_id');
    res.render('attendance', { records, today });
});

app.post('/attendance/check-in', isAuthenticated, attachBusinessContext, async (req, res) => {
    try {
        const today = moment().format('YYYY-MM-DD');
        const existing = await Attendance.findOne({ user_id: req.session.userId, date: today });
        if (existing) throw new Error("Already checked in");
        
        const checkInTime = moment().format('HH:mm');
        const status = moment(checkInTime, 'HH:mm').isAfter(moment('09:00', 'HH:mm')) ? 'late' : 'present';
        
        await new Attendance({ user_id: req.session.userId, business_id: req.business_id, date: today, check_in: checkInTime, status }).save();
        req.session.success_msg = "Checked in successfully";
        res.redirect('/pos');
    } catch (err) {
        req.session.error_msg = err.message;
        res.redirect('/attendance');
    }
});

// ==========================================
// REPORTS ROUTES
// ==========================================
app.get('/reports/sales', isAuthenticated, attachBusinessContext, async (req, res) => {
    const { start_date, end_date } = req.query;
    const matchStage = { business_id: new mongoose.Types.ObjectId(req.business_id), status: 'completed' };
    
    if (start_date && end_date) {
        matchStage.created_at = { $gte: new Date(start_date), $lte: new Date(end_date + "T23:59:59") };
    } else {
        matchStage.created_at = { $gte: moment().startOf('month').toDate() };
    }

    const salesData = await Sale.aggregate([
        { $match: matchStage },
        { $group: { _id: null, totalSales: { $sum: "$grand_total" }, totalDue: { $sum: "$due_amount" }, txCount: { $sum: 1 } } }
    ]);

    const salesList = await Sale.find(matchStage).populate('customer_id sold_by').sort({ created_at: -1 });
    
    res.render('sales-report', { 
        report: salesData[0] || { totalSales: 0, totalDue: 0, txCount: 0 }, 
        salesList, 
        start_date: start_date || moment().startOf('month').format('YYYY-MM-DD'),
        end_date: end_date || moment().endOf('month').format('YYYY-MM-DD')
    });
});

// ==========================================
// SETTINGS ROUTES
// ==========================================
app.get('/settings', isAuthenticated, attachBusinessContext, async (req, res) => {
    const business = await Business.findById(req.business_id);
    res.render('settings', { business });
});

app.post('/settings', isAuthenticated, attachBusinessContext, hasRole('owner'), upload.single('logo'), async (req, res) => {
    try {
        const { name, address, phone, trade_license_no, tax_rate } = req.body;
        const updateData = { name, address, phone, trade_license_no, tax_rate };
        if (req.file) updateData.logo = `/uploads/${req.file.filename}`;
        
        await Business.findByIdAndUpdate(req.business_id, updateData);
        req.session.success_msg = "Settings updated";
        res.redirect('/settings');
    } catch (err) {
        req.session.error_msg = err.message;
        res.redirect('/settings');
    }
});

// ==========================================
// INVOICE PDF GENERATION (PDFKIT)
// ==========================================
app.get('/invoice/:id/pdf', isAuthenticated, attachBusinessContext, async (req, res) => {
    try {
        const sale = await Sale.findById(req.params.id).populate('business_id customer_id sold_by items.product_id');
        if (!sale) return res.status(404).send('Invoice not found');
        
        const business = sale.business_id;
        
        const PDFDocument = require('pdfkit');
        const doc = new PDFDocument({ size: [80 * 2.83, 200 * 2.83], margin: 10 }); // 80mm thermal width roughly
        
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename=${sale.invoice_no}.pdf`);
        doc.pipe(res);

        doc.fontSize(12).text(business.name, { align: 'center' });
        if (business.phone) doc.fontSize(8).text(`Phone: ${business.phone}`, { align: 'center' });
        if (business.address) doc.fontSize(8).text(`Address: ${business.address}`, { align: 'center' });
        
        doc.moveDown(0.5);
        doc.fontSize(8).text(`Invoice: ${sale.invoice_no} | Date: ${moment(sale.created_at).format('DD/MM/YYYY HH:mm')}`);
        if (sale.customer_id) doc.text(`Customer: ${sale.customer_id.name}`);
        doc.text(`Cashier: ${sale.sold_by.full_name}`);
        
        doc.moveDown(0.5);
        doc.moveTo(10, doc.y).lineTo(210, doc.y).stroke();
        doc.moveDown(0.3);

        let y = doc.y;
        doc.fontSize(7).text("Item", 10, y, { width: 90 });
        doc.text("Qty", 100, y, { width: 20, align: 'right' });
        doc.text("Total", 170, y, { width: 40, align: 'right' });
        y += 10;
        doc.moveTo(10, y).lineTo(210, y).stroke();
        y += 3;

        sale.items.forEach(item => {
            const itemTotal = (item.qty * item.unit_price) - item.discount;
            doc.fontSize(7).text(item.product_id.name.substring(0, 20), 10, y, { width: 90 });
            doc.text(`${item.qty}x${item.unit_price}`, 100, y, { width: 70, align: 'right' });
            doc.text(formatBDT(itemTotal), 170, y, { width: 40, align: 'right' });
            y += 10;
        });

        doc.moveTo(10, y).lineTo(210, y).stroke();
        y += 5;
        doc.fontSize(8).text(`Subtotal: ${formatBDT(sale.subtotal)}`, 120, y, { width: 90, align: 'right' }); y += 10;
        if (sale.discount_total > 0) {
            doc.text(`Discount: -${formatBDT(sale.discount_total)}`, 120, y, { width: 90, align: 'right' }); y += 10;
        }
        if (sale.vat_tax > 0) {
            doc.text(`VAT/Tax: +${formatBDT(sale.vat_tax)}`, 120, y, { width: 90, align: 'right' }); y += 10;
        }
        doc.fontSize(10).text(`TOTAL: ${formatBDT(sale.grand_total)}`, 120, y, { width: 90, align: 'right' }); y += 15;
        doc.fontSize(8).text(`Paid: ${formatBDT(sale.paid_amount)} | Due: ${formatBDT(sale.due_amount)}`, 100, y, { width: 110, align: 'right' }); y += 15;
        
        doc.fontSize(8).text("Thank you for your purchase!", { align: 'center' });

        doc.end();
    } catch (err) {
        res.status(500).send(err.message);
    }
});

// ==========================================
// EXCEL EXPORT EXAMPLE (Sales Report)
// ==========================================
app.get('/reports/sales/excel', isAuthenticated, attachBusinessContext, async (req, res) => {
    try {
        const sales = await Sale.find({ business_id: req.business_id, status: 'completed' })
            .populate('customer_id sold_by items.product_id').sort({ created_at: -1 });

        const ExcelJS = require('exceljs');
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Sales Report');

        worksheet.columns = [
            { header: 'Invoice No', key: 'invoice_no', width: 15 },
            { header: 'Date', key: 'date', width: 20 },
            { header: 'Customer', key: 'customer', width: 20 },
            { header: 'Items', key: 'items_str', width: 40 },
            { header: 'Total', key: 'grand_total', width: 15 },
            { header: 'Payment', key: 'payment_method', width: 15 },
            { header: 'Sold By', key: 'sold_by', width: 20 }
        ];

        sales.forEach(sale => {
            worksheet.addRow({
                invoice_no: sale.invoice_no,
                date: moment(sale.created_at).format('YYYY-MM-DD HH:mm'),
                customer: sale.customer_id ? sale.customer_id.name : 'Walk-in',
                items_str: sale.items.map(i => `${i.product_id.name} x${i.qty}`).join(', '),
                grand_total: sale.grand_total,
                payment_method: sale.payment_method,
                sold_by: sale.sold_by.full_name
            });
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=Sales_Report.xlsx');
        await workbook.xlsx.write(res);
        res.end();
    } catch (err) {
        res.status(500).send(err.message);
    }
});

// ==========================================
// 404 HANDLER
// ==========================================
app.use((req, res) => {
    res.status(404).render('404');
});

// ==========================================
// SERVER LISTEN
// ==========================================
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT} in ${process.env.NODE_ENV || 'development'} mode`);
});
