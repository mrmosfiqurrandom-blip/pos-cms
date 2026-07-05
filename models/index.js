const mongoose = require('mongoose');

// -----------------------------
// Business Schema
// -----------------------------
const businessSchema = new mongoose.Schema({
    name: { type: String, required: true },
    owner_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    logo: { type: String, default: '' },
    address: { type: String },
    phone: { type: String },
    trade_license_no: { type: String },
    subscription_plan: { type: String, enum: ['free', 'basic', 'pro'], default: 'free' },
    subscription_expiry: { type: Date },
    currency: { type: String, default: 'BDT' },
    tax_rate: { type: Number, default: 0 } // Percentage
}, { timestamps: { createdAt: 'created_at', updatedAt: false } });

// -----------------------------
// User Schema
// -----------------------------
const userSchema = new mongoose.Schema({
    full_name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    phone: { type: String },
    password: { type: String, required: true },
    role: { type: String, enum: ['owner', 'admin', 'manager', 'cashier', 'staff'], required: true },
    business_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true },
    permissions: [{ type: String }],
    is_active: { type: Boolean, default: true },
    last_login: { type: Date },
}, { timestamps: { createdAt: 'created_at', updatedAt: false } });

// -----------------------------
// Category Schema
// -----------------------------
const categorySchema = new mongoose.Schema({
    name: { type: String, required: true },
    business_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true },
    parent_category_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null }
}, { timestamps: { createdAt: 'created_at', updatedAt: false } });

// -----------------------------
// Product Schema
// -----------------------------
const productSchema = new mongoose.Schema({
    name: { type: String, required: true },
    sku: { type: String, required: true, unique: true },
    barcode: { type: String },
    category_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Category' },
    business_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true },
    unit: { type: String, enum: ['pcs', 'kg', 'liter', 'box'], default: 'pcs' },
    purchase_price: { type: Number, required: true, default: 0 },
    sale_price: { type: Number, required: true, default: 0 },
    stock_qty: { type: Number, required: true, default: 0 },
    low_stock_alert_qty: { type: Number, default: 5 },
    product_image: { type: String, default: '' },
    is_active: { type: Boolean, default: true }
}, { timestamps: { createdAt: 'created_at', updatedAt: false } });

// -----------------------------
// Supplier Schema
// -----------------------------
const supplierSchema = new mongoose.Schema({
    name: { type: String, required: true },
    phone: { type: String, required: true },
    address: { type: String },
    business_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true },
    due_amount: { type: Number, default: 0 }
}, { timestamps: { createdAt: 'created_at', updatedAt: false } });

// -----------------------------
// Customer Schema
// -----------------------------
const customerSchema = new mongoose.Schema({
    name: { type: String, required: true },
    phone: { type: String, required: true },
    address: { type: String },
    business_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true },
    due_amount: { type: Number, default: 0 },
    loyalty_points: { type: Number, default: 0 }
}, { timestamps: { createdAt: 'created_at', updatedAt: false } });

// -----------------------------
// Purchase Schema
// -----------------------------
const purchaseSchema = new mongoose.Schema({
    supplier_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true },
    business_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true },
    items: [{
        product_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
        qty: { type: Number, required: true },
        unit_price: { type: Number, required: true }
    }],
    total_amount: { type: Number, required: true },
    paid_amount: { type: Number, default: 0 },
    due_amount: { type: Number, default: 0 },
    payment_status: { type: String, enum: ['paid', 'partial', 'due'], default: 'due' },
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: { createdAt: 'created_at', updatedAt: false } });

// -----------------------------
// Sale (Invoice) Schema
// -----------------------------
const saleSchema = new mongoose.Schema({
    invoice_no: { type: String, required: true },
    customer_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null },
    business_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true },
    items: [{
        product_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
        qty: { type: Number, required: true },
        unit_price: { type: Number, required: true },
        discount: { type: Number, default: 0 }
    }],
    subtotal: { type: Number, required: true },
    discount_total: { type: Number, default: 0 },
    vat_tax: { type: Number, default: 0 },
    grand_total: { type: Number, required: true },
    paid_amount: { type: Number, default: 0 },
    due_amount: { type: Number, default: 0 },
    payment_method: { type: String, enum: ['cash', 'card', 'bkash', 'nagad', 'bank'], default: 'cash' },
    payment_status: { type: String, enum: ['paid', 'partial', 'due'], default: 'paid' },
    status: { type: String, enum: ['completed', 'held'], default: 'completed' }, // For hold/resume feature
    sold_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: { createdAt: 'created_at', updatedAt: false } });

// -----------------------------
// Expense Schema
// -----------------------------
const expenseSchema = new mongoose.Schema({
    business_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true },
    category: { type: String, enum: ['rent', 'salary', 'utility', 'other'], required: true },
    amount: { type: Number, required: true },
    note: { type: String },
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: { createdAt: 'created_at', updatedAt: false } });

// -----------------------------
// Stock Adjustment Schema
// -----------------------------
const stockAdjustmentSchema = new mongoose.Schema({
    product_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    business_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true },
    type: { type: String, enum: ['damage', 'return', 'correction'], required: true },
    qty_change: { type: Number, required: true }, // Negative for damage, positive for return/correction
    reason: { type: String },
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: { createdAt: 'created_at', updatedAt: false } });

// -----------------------------
// Attendance Schema
// -----------------------------
const attendanceSchema = new mongoose.Schema({
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    business_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true },
    date: { type: String, required: true }, // YYYY-MM-DD format
    check_in: { type: String },
    check_out: { type: String },
    status: { type: String, enum: ['present', 'absent', 'late'], default: 'present' }
}, { timestamps: { createdAt: 'created_at', updatedAt: false } });

// -----------------------------
// Notification Schema
// -----------------------------
const notificationSchema = new mongoose.Schema({
    business_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true },
    message: { type: String, required: true },
    type: { type: String, enum: ['low_stock', 'due_reminder', 'system'], default: 'system' },
    is_read: { type: Boolean, default: false }
}, { timestamps: { createdAt: 'created_at', updatedAt: false } });

// -----------------------------
// Activity Log Schema
// -----------------------------
const activityLogSchema = new mongoose.Schema({
    business_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true },
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    action: { type: String, required: true },
    details: { type: mongoose.Schema.Types.Mixed }
}, { timestamps: { createdAt: 'created_at', updatedAt: false } });


// Compile Models
const Business = mongoose.model('Business', businessSchema);
const User = mongoose.model('User', userSchema);
const Category = mongoose.model('Category', categorySchema);
const Product = mongoose.model('Product', productSchema);
const Supplier = mongoose.model('Supplier', supplierSchema);
const Customer = mongoose.model('Customer', customerSchema);
const Purchase = mongoose.model('Purchase', purchaseSchema);
const Sale = mongoose.model('Sale', saleSchema);
const Expense = mongoose.model('Expense', expenseSchema);
const StockAdjustment = mongoose.model('StockAdjustment', stockAdjustmentSchema);
const Attendance = mongoose.model('Attendance', attendanceSchema);
const Notification = mongoose.model('Notification', notificationSchema);
const ActivityLog = mongoose.model('ActivityLog', activityLogSchema);

module.exports = {
    Business, User, Category, Product, Supplier, Customer,
    Purchase, Sale, Expense, StockAdjustment, Attendance,
    Notification, ActivityLog
};
