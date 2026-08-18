# Discipl Partner - Cashier QR Scanner Web App

A lightweight, mobile-responsive Web App for Partner Merchants (Hotels, Restaurants, Health Cafes, Spas, and Sports Stores) to scan customer Discipl QR passes, verify active memberships in real-time, apply instant discounts, and credit affiliate XP/points to customers.

## 🚀 Features

1. **Cashier PIN / Account Authentication**:
   - Secure login for partner merchant staff and cashiers.
   - Preserves session in `localStorage`.

2. **Live HTML5 Camera QR Scanner**:
   - Fast, continuous camera scanning using `html5-qrcode`.
   - Supports camera switching (Rear / Front) and manual code input fallback (`DISC-XXXXXX`).

3. **Instant Member Verification**:
   - Validates active Discipl gym membership status in real-time.
   - Shows customer profile picture, full name, member code, and registered fitness center.
   - Prevents discounts for expired or non-active members.

4. **Real-time Bill Calculator**:
   - Enter gross bill amount (₹) $\rightarrow$ automatically calculates discount saved, final payable amount, and customer reward XP points.
   - Optional bill / invoice number entry.

5. **Instant Receipt & Shift Summary**:
   - Clean digital receipt modal upon transaction completion.
   - "Today's Bills" tab tracking total footfall, total sales, and discounts given for the shift.

6. **Configurable API Endpoint**:
   - Change backend API base URL directly from the settings gear icon (e.g. `http://localhost:8000` or production URL).

---

## 🛠️ Quick Local Setup

1. Simply open `index.html` in any web browser, or serve it with Python / Node:
   ```bash
   # Using Python
   python -m http.server 3000
   ```
2. Open `http://localhost:3000` in your browser or phone on the same Wi-Fi.

---

## 📦 Deployment

### Deploy to GitHub Pages / Vercel / Netlify:
1. Push this folder to `https://github.com/adilnabhan/qr.git`:
   ```bash
   git remote add origin https://github.com/adilnabhan/qr.git
   git add .
   git commit -m "feat: Initial release of Discipl Partner Cashier QR Scanner Web App"
   git push -u origin main
   ```
2. In GitHub, go to **Settings > Pages > Deploy from branch (main)**.
3. Your live cashier scanner is now online at `https://adilnabhan.github.io/qr/`!
