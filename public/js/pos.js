// ==========================================
// POS Terminal Frontend Logic
// ==========================================

let cart = [];
let currentHeldSaleId = null;

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('pos-search');
    if (searchInput) searchInput.focus();

    // Keyboard Shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === 'F2') { // Focus Search
            e.preventDefault();
            searchInput.focus();
        }
        if (e.key === 'F9') { // Checkout
            e.preventDefault();
            checkout();
        }
    });

    // Search Input Listener with Debounce
    let timeout;
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => searchProducts(e.target.value), 300);
        });
    }

    // Recalculate totals when payment inputs change
    ['overall-discount', 'vat-rate', 'paid-amount'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', calculateTotals);
    });
});

// Search Products via API
async function searchProducts(query) {
    const grid = document.getElementById('product-grid');
    if (!query.trim()) {
        renderProducts(window.initialProducts);
        return;
    }
    try {
        const res = await fetch(`/api/products/search?q=${encodeURIComponent(query)}`);
        const products = await res.json();
        window.searchResults = products; // Store for addToCart
        renderProducts(products);
    } catch (err) {
        console.error("Search error:", err);
    }
}

// Render Product Grid
function renderProducts(products) {
    const grid = document.getElementById('product-grid');
    if (!grid) return;
    
    grid.innerHTML = products.map(p => `
        <div class="pos-product-card ${p.stock_qty <= 0 ? 'out-of-stock' : ''}" onclick="addToCart('${p._id}')">
            <h4>${p.name}</h4>
            <div class="price">৳${Number(p.sale_price).toFixed(2)}</div>
            <div class="stock">Stock: ${p.stock_qty} ${p.unit}</div>
        </div>
    `).join('');
}

// Add to Cart
function addToCart(productId) {
    // Find product from initial load or search results to avoid extra API calls
    const product = window.initialProducts.find(p => p._id === productId) || 
                    (window.searchResults ? window.searchResults.find(p => p._id === productId) : null);
    
    if (!product) return;
    if (product.stock_qty <= 0) return alert('Out of stock!');

    const existingItem = cart.find(item => item.product_id === productId);
    
    if (existingItem) {
        if (existingItem.qty >= product.stock_qty) return alert('Not enough stock in inventory!');
        existingItem.qty++;
    } else {
        cart.push({
            product_id: product._id,
            name: product.name,
            sale_price: product.sale_price,
            qty: 1,
            discount: 0
        });
    }
    
    updateCartUI();
    
    // Clear search and refocus for rapid barcode scanner gun input
    const searchInput = document.getElementById('pos-search');
    searchInput.value = '';
    renderProducts(window.initialProducts);
    searchInput.focus();
}

// Remove from Cart
function removeFromCart(index) {
    cart.splice(index, 1);
    updateCartUI();
}

// Change Quantity
function changeQty(index, delta) {
    cart[index].qty += delta;
    if (cart[index].qty <= 0) {
        cart.splice(index, 1);
    }
    updateCartUI();
}

// Update Cart UI
function updateCartUI() {
    const cartItemsEl = document.getElementById('cart-items');
    const checkoutBtn = document.getElementById('checkout-btn');

    if (cart.length === 0) {
        cartItemsEl.innerHTML = '<p style="text-align:center; color:#9ca3af; margin-top:20px;">Cart is empty</p>';
        if(checkoutBtn) checkoutBtn.disabled = true;
    } else {
        if(checkoutBtn) checkoutBtn.disabled = false;
        cartItemsEl.innerHTML = cart.map((item, i) => `
            <div class="cart-item">
                <div class="cart-item-details">
                    <div class="cart-item-name">${item.name}</div>
                    <div class="cart-item-price">৳${item.sale_price} x ${item.qty}</div>
                </div>
                <div class="cart-item-actions">
                    <button onclick="changeQty(${i}, -1)">-</button>
                    <span>${item.qty}</span>
                    <button onclick="changeQty(${i}, 1)">+</button>
                    <button onclick="removeFromCart(${i})" style="background:#dc2626">X</button>
                </div>
                <div class="cart-item-total">৳${(item.sale_price * item.qty - item.discount).toFixed(2)}</div>
            </div>
        `).join('');
    }
    calculateTotals();
}

// Calculate Totals (Client-side display only, server validates)
function calculateTotals() {
    let subtotal = 0;
    let itemDiscountTotal = 0;
    
    cart.forEach(item => {
        subtotal += item.sale_price * item.qty;
        itemDiscountTotal += item.discount;
    });

    const overallDiscount = Number(document.getElementById('overall-discount')?.value || 0);
    const vatRate = Number(document.getElementById('vat-rate')?.value || 0);
    
    const totalDiscount = itemDiscountTotal + overallDiscount;
    const vatAmount = ((subtotal - totalDiscount) * (vatRate / 100));
    const grandTotal = (subtotal - totalDiscount + vatAmount);
    
    const paidAmount = Number(document.getElementById('paid-amount')?.value || 0);
    const dueAmount = grandTotal - paidAmount;

    // Update DOM
    const fmt = (num) => '৳' + Number(num).toFixed(2);
    document.getElementById('subtotal-val').innerText = fmt(subtotal);
    document.getElementById('discount-val').innerText = '- ' + fmt(totalDiscount);
    document.getElementById('vat-val').innerText = '+ ' + fmt(vatAmount);
    document.getElementById('total-val').innerText = fmt(grandTotal);
    document.getElementById('due-val').innerText = fmt(Math.max(0, dueAmount));
    
    // Auto-fill full payment if cart changes and paid is 0
    if (paidAmount === 0 && grandTotal > 0) {
        document.getElementById('paid-amount').value = grandTotal.toFixed(2);
    }
}

// Checkout Process
async function checkout() {
    if (cart.length === 0) return alert("Cart is empty!");
    
    const btn = document.getElementById('checkout-btn');
    const originalText = btn.innerText;
    btn.disabled = true;
    btn.innerText = 'Processing...';

    const payload = {
        cart: cart,
        customer_id: document.getElementById('customer-select')?.value || null,
        discount_total: Number(document.getElementById('overall-discount')?.value || 0),
        vat_tax: Number(document.getElementById('vat-rate')?.value || 0),
        paid_amount: Number(document.getElementById('paid-amount')?.value || 0),
        payment_method: document.getElementById('payment-method')?.value || 'cash',
        hold_sale_id: currentHeldSaleId || null
    };

    try {
        const res = await fetch('/pos/checkout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        
        if (data.success) {
            alert(`Sale Successful!\nInvoice: ${data.invoice_no}`);
            // Open thermal receipt PDF in new tab
            window.open(`/invoice/${data.sale_id}/pdf`, '_blank');
            
            // Reset POS
            cart = [];
            currentHeldSaleId = null;
            updateCartUI();
            if(document.getElementById('overall-discount')) document.getElementById('overall-discount').value = 0;
        } else {
            alert('Checkout Failed: ' + data.message);
        }
    } catch (err) {
        alert('Network error. Please try again.');
    } finally {
        btn.disabled = false;
        btn.innerText = originalText;
    }
}

// Hold / Park Current Sale
async function holdCurrentSale() {
    if (cart.length === 0) return alert("Cart is empty!");
    try {
        const res = await fetch('/pos/hold', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                cart: cart, 
                customer_id: document.getElementById('customer-select')?.value || null
            })
        });
        const data = await res.json();
        if (data.success) {
            alert(data.message);
            cart = [];
            updateCartUI();
            window.location.reload(); // Refresh to load new held sales
        } else {
            alert('Error: ' + data.message);
        }
    } catch (err) { 
        alert('Error holding sale'); 
    }
}
