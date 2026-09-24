/**
 * Discipl Partner Cashier QR Scanner Web Application
 * Handles Staff Authentication, Live QR Scanning, Verification, Bill Discount Calculation, and Transaction Recording.
 */

// State Management
const defaultBackendUrl = (window.location.origin.includes('localhost') || window.location.origin.includes('127.0.0.1'))
  ? 'http://localhost:8000'
  : 'https://app.thediscipl.com';

let savedApiUrl = localStorage.getItem('discipl_api_url');
if (!savedApiUrl || savedApiUrl.includes('qr-') || savedApiUrl.includes('github.io') || savedApiUrl.includes('onrender.com')) {
  savedApiUrl = defaultBackendUrl;
  localStorage.setItem('discipl_api_url', savedApiUrl);
}

const state = {
  apiBaseUrl: savedApiUrl,
  token: localStorage.getItem('discipl_partner_token') || null,
  staff: JSON.parse(localStorage.getItem('discipl_partner_staff') || 'null'),
  merchant: JSON.parse(localStorage.getItem('discipl_partner_merchant') || 'null'),
  currentScannedData: null,
  html5QrCode: null,
  currentCameraIndex: 0,
  cameras: [],
  isScanning: false,
};

// Helper functions for discount eligibility and calculations
function getIsEligible(data) {
  if (!data) return false;
  if (typeof data.is_eligible_for_discount === 'boolean') return data.is_eligible_for_discount;
  if (typeof data.eligible_for_discount === 'boolean') return data.eligible_for_discount;
  if (data.customer && typeof data.customer.is_eligible_for_discount === 'boolean') return data.customer.is_eligible_for_discount;
  if (data.customer && typeof data.customer.eligible_for_discount === 'boolean') return data.customer.eligible_for_discount;
  if (data.discount_info && typeof data.discount_info.eligible_for_discount === 'boolean') return data.discount_info.eligible_for_discount;
  if (data.discount_offer && typeof data.discount_offer.eligible_for_discount === 'boolean') return data.discount_offer.eligible_for_discount;
  if (typeof data.is_active_member === 'boolean') return data.is_active_member;
  if (data.customer && typeof data.customer.is_active_member === 'boolean') return data.customer.is_active_member;
  return false;
}

function getDiscountPercentage(data, merchant, isEligible) {
  if (!isEligible) return 0;
  const offer = data?.discount_offer || data?.discount_info;
  if (offer && offer.discount_percentage !== undefined && offer.discount_percentage !== null) {
    const val = parseFloat(offer.discount_percentage);
    if (!isNaN(val)) return val;
  }
  if (merchant && merchant.discount_percentage !== undefined && merchant.discount_percentage !== null) {
    const val = parseFloat(merchant.discount_percentage);
    if (!isNaN(val)) return val;
  }
  return 0;
}

function getMinBillAmount(data, merchant) {
  const offer = data?.discount_offer || data?.discount_info;
  if (offer && offer.min_bill_amount !== undefined && offer.min_bill_amount !== null) {
    return parseFloat(offer.min_bill_amount) || 0;
  }
  if (merchant && merchant.min_bill_amount !== undefined && merchant.min_bill_amount !== null) {
    return parseFloat(merchant.min_bill_amount) || 0;
  }
  return 0;
}

function getMaxDiscountAmount(data, merchant) {
  const offer = data?.discount_offer || data?.discount_info;
  if (offer && offer.max_discount_amount !== undefined && offer.max_discount_amount !== null) {
    return parseFloat(offer.max_discount_amount) || null;
  }
  if (merchant && merchant.max_discount_amount !== undefined && merchant.max_discount_amount !== null) {
    return parseFloat(merchant.max_discount_amount) || null;
  }
  return null;
}

// DOM Elements
const elements = {
  // Screens
  loginScreen: document.getElementById('loginScreen'),
  scannerScreen: document.getElementById('scannerScreen'),

  // Header
  headerRight: document.getElementById('headerRight'),
  logoutBtn: document.getElementById('logoutBtn'),

  // Login
  loginForm: document.getElementById('loginForm'),
  loginUsername: document.getElementById('loginUsername'),
  loginPassword: document.getElementById('loginPassword'),
  loginSubmitBtn: document.getElementById('loginSubmitBtn'),
  loginSpinner: document.getElementById('loginSpinner'),
  loginError: document.getElementById('loginError'),

  // Merchant Bar
  merchantName: document.getElementById('merchantName'),
  merchantDiscountBadge: document.getElementById('merchantDiscountBadge'),
  staffRole: document.getElementById('staffRole'),
  staffName: document.getElementById('staffName'),

  // Tabs
  tabBtns: document.querySelectorAll('.tab-btn'),
  tabContents: document.querySelectorAll('.tab-content'),
  todayCount: document.getElementById('todayCount'),

  // Scanner & Bill
  scannerCard: document.getElementById('scannerCard'),
  scannerOverlay: document.getElementById('scannerOverlay'),
  toggleCameraBtn: document.getElementById('toggleCameraBtn'),
  manualEntryBtn: document.getElementById('manualEntryBtn'),
  manualCodeBox: document.getElementById('manualCodeBox'),
  manualCodeInput: document.getElementById('manualCodeInput'),
  verifyManualCodeBtn: document.getElementById('verifyManualCodeBtn'),
  closeManualBtn: document.getElementById('closeManualBtn'),

  // Bill Card
  billCard: document.getElementById('billCard'),
  memberAvatar: document.getElementById('memberAvatar'),
  memberName: document.getElementById('memberName'),
  memberStatusBadge: document.getElementById('memberStatusBadge'),
  memberCode: document.getElementById('memberCode'),
  memberGym: document.getElementById('memberGym'),
  discountBanner: document.getElementById('discountBanner'),
  discountIcon: document.getElementById('discountIcon'),
  eligibleDiscountText: document.getElementById('eligibleDiscountText'),
  eligibleReasonText: document.getElementById('eligibleReasonText'),
  minPurchaseNotice: document.getElementById('minPurchaseNotice'),
  billAmountInput: document.getElementById('billAmountInput'),
  minPurchaseWarning: document.getElementById('minPurchaseWarning'),
  warningMinAmount: document.getElementById('warningMinAmount'),
  invoiceNoInput: document.getElementById('invoiceNoInput'),

  // Breakdown
  breakdownGross: document.getElementById('breakdownGross'),
  breakdownDiscountRate: document.getElementById('breakdownDiscountRate'),
  breakdownDiscountAmount: document.getElementById('breakdownDiscountAmount'),
  breakdownFinalAmount: document.getElementById('breakdownFinalAmount'),
  breakdownPoints: document.getElementById('breakdownPoints'),

  // Actions
  resetScanBtn: document.getElementById('resetScanBtn'),
  submitTransactionBtn: document.getElementById('submitTransactionBtn'),
  submitSpinner: document.getElementById('submitSpinner'),

  // Receipt Modal
  receiptModal: document.getElementById('receiptModal'),
  receiptTxnId: document.getElementById('receiptTxnId'),
  receiptCustomer: document.getElementById('receiptCustomer'),
  receiptOriginal: document.getElementById('receiptOriginal'),
  receiptDiscount: document.getElementById('receiptDiscount'),
  receiptFinal: document.getElementById('receiptFinal'),
  receiptPoints: document.getElementById('receiptPoints'),
  closeReceiptBtn: document.getElementById('closeReceiptBtn'),

  // History Tab
  statTotalBills: document.getElementById('statTotalBills'),
  statTotalSales: document.getElementById('statTotalSales'),
  statTotalDiscounts: document.getElementById('statTotalDiscounts'),
  historyList: document.getElementById('historyList'),
};

// Initialization
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  elements.apiUrlInput.value = state.apiBaseUrl;

  if (state.token && state.staff && state.merchant) {
    showScannerScreen();
  } else {
    showLoginScreen();
  }
});

// Event Listeners Setup
function setupEventListeners() {
  // Login
  elements.loginForm.addEventListener('submit', handleLogin);
  elements.logoutBtn.addEventListener('click', handleLogout);



  // Tabs
  elements.tabBtns.forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Camera & Manual
  elements.toggleCameraBtn.addEventListener('click', toggleCamera);
  elements.manualEntryBtn.addEventListener('click', () => {
    elements.manualCodeBox.classList.toggle('hidden');
    elements.manualCodeInput.focus();
  });
  elements.closeManualBtn.addEventListener('click', () => elements.manualCodeBox.classList.add('hidden'));
  elements.verifyManualCodeBtn.addEventListener('click', () => {
    const code = elements.manualCodeInput.value.trim();
    if (code) {
      verifyQrCode(code);
    }
  });

  // Bill Input Calculations
  elements.billAmountInput.addEventListener('input', calculateBreakdown);

  // Submit Transaction
  elements.submitTransactionBtn.addEventListener('click', submitTransaction);
  elements.resetScanBtn.addEventListener('click', resetToScan);

  // Receipt Modal
  elements.closeReceiptBtn.addEventListener('click', () => {
    elements.receiptModal.classList.add('hidden');
    resetToScan();
    loadTodayHistory();
  });
}

// -------------------------------------------------------------
// Authentication
// -------------------------------------------------------------
async function handleLogin(e) {
  e.preventDefault();
  const username = elements.loginUsername.value.trim();
  const password = elements.loginPassword.value.trim();

  elements.loginError.classList.add('hidden');
  elements.loginSpinner.classList.remove('hidden');
  elements.loginSubmitBtn.disabled = true;

  try {
    const response = await fetch(`${state.apiBaseUrl}/api/v1/partners/auth/login/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    let data;
    try {
      data = await response.json();
    } catch (parseErr) {
      throw new Error(`Cannot reach backend API (${response.status}). Please check your internet connection.`);
    }

    if (!response.ok) {
      throw new Error(data.error || data.detail || 'Login failed. Please check credentials.');
    }

    state.token = data.access_token || data.token;
    state.staff = data.staff;
    state.merchant = data.merchant;

    localStorage.setItem('discipl_partner_token', state.token);
    localStorage.setItem('discipl_partner_staff', JSON.stringify(state.staff));
    localStorage.setItem('discipl_partner_merchant', JSON.stringify(state.merchant));

    showScannerScreen();
  } catch (err) {
    elements.loginError.textContent = err.message;
    elements.loginError.classList.remove('hidden');
  } finally {
    elements.loginSpinner.classList.add('hidden');
    elements.loginSubmitBtn.disabled = false;
  }
}

function handleLogout() {
  if (confirm('Are you sure you want to log out of the cashier session?')) {
    stopCamera();
    state.token = null;
    state.staff = null;
    state.merchant = null;
    localStorage.removeItem('discipl_partner_token');
    localStorage.removeItem('discipl_partner_staff');
    localStorage.removeItem('discipl_partner_merchant');
    showLoginScreen();
  }
}

// -------------------------------------------------------------
// Screen Transitions
// -------------------------------------------------------------
function showLoginScreen() {
  elements.loginScreen.classList.add('active');
  elements.scannerScreen.classList.remove('active');
  elements.logoutBtn.classList.add('hidden');
}

function showScannerScreen() {
  elements.loginScreen.classList.remove('active');
  elements.scannerScreen.classList.add('active');
  elements.logoutBtn.classList.remove('hidden');

  // Populate Merchant Info
  if (state.merchant) {
    elements.merchantName.textContent = state.merchant.name;
    const discPct = state.merchant.discount_percentage || 0;
    elements.merchantDiscountBadge.textContent = `${discPct}% DISCOUNT`;
  }
  if (state.staff) {
    elements.staffName.textContent = state.staff.name;
    elements.staffRole.textContent = state.staff.role || 'Cashier';
  }

  startCameraScanner();
  loadTodayHistory();
}

function switchTab(tabId) {
  elements.tabBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
  elements.tabContents.forEach(c => c.classList.toggle('active', c.id === tabId));

  if (tabId === 'scanTab') {
    if (!state.currentScannedData) {
      startCameraScanner();
    }
  } else if (tabId === 'historyTab') {
    loadTodayHistory();
  }
}

// -------------------------------------------------------------
// HTML5 QR Code Scanner Engine
// -------------------------------------------------------------
async function startCameraScanner() {
  if (state.isScanning) return;

  try {
    if (!state.html5QrCode) {
      state.html5QrCode = new Html5Qrcode("reader");
    }

    state.cameras = await Html5Qrcode.getCameras();
    if (!state.cameras || state.cameras.length === 0) {
      console.warn("No camera detected. Manual entry fallback active.");
      return;
    }

    let cameraId = state.cameras[0].id;
    for (let i = 0; i < state.cameras.length; i++) {
      const label = state.cameras[i].label.toLowerCase();
      if (label.includes('back') || label.includes('rear') || label.includes('environment')) {
        cameraId = state.cameras[i].id;
        state.currentCameraIndex = i;
        break;
      }
    }

    const config = {
      fps: 15,
      qrbox: { width: 250, height: 250 },
      aspectRatio: 1.0,
    };

    await state.html5QrCode.start(
      cameraId,
      config,
      (decodedText) => {
        onQrCodeScanned(decodedText);
      },
      () => {}
    );

    state.isScanning = true;
    elements.scannerOverlay.classList.remove('hidden');
  } catch (err) {
    console.error("Camera start error:", err);
  }
}

async function stopCamera() {
  if (state.html5QrCode && state.isScanning) {
    try {
      await state.html5QrCode.stop();
      state.isScanning = false;
    } catch (e) {
      console.warn("Camera stop error", e);
    }
  }
}

async function toggleCamera() {
  if (!state.cameras || state.cameras.length <= 1) {
    alert('Only 1 camera detected on this device.');
    return;
  }
  await stopCamera();
  state.currentCameraIndex = (state.currentCameraIndex + 1) % state.cameras.length;
  await startCameraScanner();
}

function onQrCodeScanned(qrData) {
  if (navigator.vibrate) {
    navigator.vibrate([80, 50, 80]);
  }
  verifyQrCode(qrData);
}

// -------------------------------------------------------------
// Verify Scanned QR Code
// -------------------------------------------------------------
async function verifyQrCode(token) {
  stopCamera();
  elements.scannerCard.classList.add('hidden');
  elements.manualCodeBox.classList.add('hidden');

  try {
    const response = await fetch(`${state.apiBaseUrl}/api/v1/partners/scan/verify/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({ 
        token,
        merchant_id: state.merchant?.id 
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Invalid or expired QR code.');
    }

    state.currentScannedData = data;
    renderBillVerificationCard(data);
  } catch (err) {
    alert(`Verification Failed: ${err.message}`);
    resetToScan();
  }
}

// -------------------------------------------------------------
// Render Verification & Bill Calculator
// -------------------------------------------------------------
function renderBillVerificationCard(data) {
  state.currentScannedData = data;
  const customer = data.customer || data;
  const isEligible = getIsEligible(data);
  const discPct = getDiscountPercentage(data, state.merchant, isEligible);
  const minBill = getMinBillAmount(data, state.merchant);
  const maxCap = getMaxDiscountAmount(data, state.merchant);
  const reason = data.eligibility_reason || customer.eligibility_reason || (isEligible ? 'Eligible Discipl VIP Member' : 'Not eligible for discount (Membership expired, no recent workout or steps)');

  elements.memberName.textContent = customer.name || customer.customer_name || 'Discipl Member';
  elements.memberCode.textContent = customer.member_code || `DISC-${customer.id || customer.customer_id || ''}`;
  elements.memberGym.textContent = customer.gym_name || customer.home_gym || 'Discipl Fitness Center';

  if (customer.profile_image || customer.profile_picture) {
    elements.memberAvatar.src = customer.profile_image || customer.profile_picture;
  }

  // Active / Eligible status badge
  if (isEligible) {
    elements.memberStatusBadge.textContent = 'ELIGIBLE FOR DISCOUNT';
    elements.memberStatusBadge.className = 'status-badge status-active';
    if (elements.discountBanner) elements.discountBanner.classList.remove('not-eligible');
    if (elements.discountIcon) elements.discountIcon.textContent = '🎉';

    let discText = `${discPct}% Instant Discount Applicable`;
    if (maxCap && maxCap > 0) {
      discText += ` (Up to ₹${maxCap.toFixed(2)})`;
    }
    elements.eligibleDiscountText.textContent = discText;
  } else {
    elements.memberStatusBadge.textContent = 'NOT ELIGIBLE FOR DISCOUNT';
    elements.memberStatusBadge.className = 'status-badge status-inactive';
    if (elements.discountBanner) elements.discountBanner.classList.add('not-eligible');
    if (elements.discountIcon) elements.discountIcon.textContent = '⚠️';
    elements.eligibleDiscountText.textContent = '0% Discount (Conditions Not Met)';
  }

  if (elements.eligibleReasonText) {
    elements.eligibleReasonText.textContent = reason;
  }

  // Min purchase notice
  if (minBill > 0 && elements.minPurchaseNotice) {
    elements.minPurchaseNotice.textContent = `Min Purchase: ₹${minBill.toFixed(2)}`;
    elements.minPurchaseNotice.classList.remove('hidden');
  } else if (elements.minPurchaseNotice) {
    elements.minPurchaseNotice.classList.add('hidden');
  }

  elements.billCard.classList.remove('hidden');
  elements.billAmountInput.value = '';
  elements.billAmountInput.focus();
  calculateBreakdown();
}

// -------------------------------------------------------------
// Calculate Bill Breakdown in Real-Time
// -------------------------------------------------------------
function calculateBreakdown() {
  const grossAmount = parseFloat(elements.billAmountInput.value) || 0;
  const isEligible = getIsEligible(state.currentScannedData);
  const discPct = getDiscountPercentage(state.currentScannedData, state.merchant, isEligible);
  const minBill = getMinBillAmount(state.currentScannedData, state.merchant);
  const maxCap = getMaxDiscountAmount(state.currentScannedData, state.merchant);
  const ptsPer100 = state.currentScannedData?.discount_offer?.reward_points_per_100 ||
                    state.currentScannedData?.discount_info?.reward_points_per_100 ||
                    state.merchant?.reward_points_per_100_inr || 5;

  let discountAmount = 0;
  let isBelowMin = false;

  if (isEligible && discPct > 0) {
    if (minBill > 0 && grossAmount > 0 && grossAmount < minBill) {
      isBelowMin = true;
      discountAmount = 0;
    } else if (grossAmount >= minBill) {
      discountAmount = (grossAmount * discPct) / 100;
      if (maxCap && discountAmount > maxCap) {
        discountAmount = maxCap;
      }
    }
  }

  if (elements.minPurchaseWarning && elements.warningMinAmount) {
    if (isBelowMin) {
      elements.warningMinAmount.textContent = minBill.toFixed(2);
      elements.minPurchaseWarning.classList.remove('hidden');
    } else {
      elements.minPurchaseWarning.classList.add('hidden');
    }
  }

  const finalAmount = Math.max(0, grossAmount - discountAmount);
  const earnedPoints = Math.floor((finalAmount / 100) * ptsPer100);

  elements.breakdownGross.textContent = `₹${grossAmount.toFixed(2)}`;
  const offerData = state.currentScannedData?.discount_offer || state.currentScannedData?.discount_info;
  const maxCapPct = parseFloat(offerData?.max_discount_percentage || state.merchant?.discount_percentage || 0);
  if (maxCapPct > 0 && discPct < maxCapPct) {
    elements.breakdownDiscountRate.textContent = `${discPct}% (Up to ${maxCapPct}%)`;
  } else {
    elements.breakdownDiscountRate.textContent = `${discPct}%`;
  }
  elements.breakdownDiscountAmount.textContent = `- ₹${discountAmount.toFixed(2)}`;
  elements.breakdownFinalAmount.textContent = `₹${finalAmount.toFixed(2)}`;
  elements.breakdownPoints.textContent = `+ ${earnedPoints} XP`;
}

// -------------------------------------------------------------
// Submit & Record Transaction
// -------------------------------------------------------------
async function submitTransaction() {
  const billAmount = parseFloat(elements.billAmountInput.value);
  if (!billAmount || billAmount <= 0) {
    alert('Please enter a valid bill amount.');
    elements.billAmountInput.focus();
    return;
  }

  elements.submitSpinner.classList.remove('hidden');
  elements.submitTransactionBtn.disabled = true;

  try {
    const custId = state.currentScannedData?.customer?.id ||
                   state.currentScannedData?.customer?.customer_id ||
                   state.currentScannedData?.customer_id ||
                   state.currentScannedData?.id;

    const isEligible = getIsEligible(state.currentScannedData);
    const discPct = getDiscountPercentage(state.currentScannedData, state.merchant, isEligible);

    const payload = {
      customer_id: custId,
      bill_amount: billAmount,
      discount_percentage: discPct,
      invoice_number: elements.invoiceNoInput.value.trim() || undefined,
      merchant_id: state.merchant?.id || undefined,
    };

    const response = await fetch(`${state.apiBaseUrl}/api/v1/partners/scan/record-transaction/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to record transaction.');
    }

    const receipt = data.receipt || data;
    showReceiptModal(receipt);
  } catch (err) {
    alert(`Error: ${err.message}`);
  } finally {
    elements.submitSpinner.classList.add('hidden');
    elements.submitTransactionBtn.disabled = false;
  }
}

// -------------------------------------------------------------
// Show Receipt Modal
// -------------------------------------------------------------
function showReceiptModal(receipt) {
  elements.receiptTxnId.textContent = `#${receipt.transaction_id || receipt.id || ''}`;
  elements.receiptCustomer.textContent = receipt.customer_name || state.currentScannedData?.customer?.name || 'Customer';
  elements.receiptOriginal.textContent = `₹${parseFloat(receipt.bill_amount || receipt.original_bill_amount || 0).toFixed(2)}`;
  elements.receiptDiscount.textContent = `- ₹${parseFloat(receipt.discount_amount || receipt.discount_saved || 0).toFixed(2)} (${receipt.discount_percentage || 0}%)`;
  elements.receiptFinal.textContent = `₹${parseFloat(receipt.final_amount || receipt.final_amount_payable || 0).toFixed(2)}`;
  elements.receiptPoints.textContent = `+${receipt.points_awarded || receipt.points_earned || 0} XP`;

  elements.receiptModal.classList.remove('hidden');
}

function resetToScan() {
  state.currentScannedData = null;
  elements.billCard.classList.add('hidden');
  elements.scannerCard.classList.remove('hidden');
  elements.manualCodeBox.classList.add('hidden');
  startCameraScanner();
}

// -------------------------------------------------------------
// Load Today's History & Dashboard Stats
// -------------------------------------------------------------
async function loadTodayHistory() {
  try {
    const [dashRes, txnRes] = await Promise.all([
      fetch(`${state.apiBaseUrl}/api/v1/partners/dashboard/`, {
        headers: { 'Authorization': `Bearer ${state.token}` }
      }),
      fetch(`${state.apiBaseUrl}/api/v1/partners/transactions/`, {
        headers: { 'Authorization': `Bearer ${state.token}` }
      })
    ]);

    let transactions = [];
    if (txnRes.ok) {
      const txnData = await txnRes.json();
      transactions = txnData.transactions || txnData.results || (Array.isArray(txnData) ? txnData : []);
      renderHistoryList(transactions);
    }

    let statsLoaded = false;
    if (dashRes.ok) {
      const dashData = await dashRes.json();
      const stats = dashData.today_stats || dashData.today_metrics || dashData.stats || {};
      const totalBills = stats.total_scans ?? stats.scans_count ?? stats.total_transactions;
      const totalSales = stats.total_sales_amount ?? stats.total_net_revenue ?? stats.total_bill_amount;
      const totalDiscounts = stats.total_discount_given ?? stats.total_discounts;

      if (totalBills !== undefined && totalBills !== null) {
        elements.statTotalBills.textContent = totalBills;
        elements.todayCount.textContent = totalBills;
        if (Number(totalBills) > 0) statsLoaded = true;
      }
      if (totalSales !== undefined && totalSales !== null) {
        elements.statTotalSales.textContent = `₹${parseFloat(totalSales || 0).toFixed(2)}`;
      }
      if (totalDiscounts !== undefined && totalDiscounts !== null) {
        elements.statTotalDiscounts.textContent = `₹${parseFloat(totalDiscounts || 0).toFixed(2)}`;
      }
    }

    // Client-side fallback: If dashboard stats evaluated to 0 or failed to load,
    // but transactions are present in today's list, compute stats directly from the transactions array.
    if (transactions.length > 0 && (!statsLoaded || elements.statTotalBills.textContent === '0')) {
      const todayStr = new Date().toDateString();
      const todayTxns = transactions.filter(t => {
        if (!t.created_at) return true;
        return new Date(t.created_at).toDateString() === todayStr;
      });
      const activeList = todayTxns.length > 0 ? todayTxns : transactions;

      const calcBills = activeList.length;
      const calcSales = activeList.reduce((sum, t) => sum + parseFloat(t.final_amount || t.final_amount_payable || t.bill_amount || 0), 0);
      const calcDiscounts = activeList.reduce((sum, t) => sum + parseFloat(t.discount_amount || t.discount_saved || 0), 0);

      elements.statTotalBills.textContent = calcBills;
      elements.todayCount.textContent = calcBills;
      elements.statTotalSales.textContent = `₹${calcSales.toFixed(2)}`;
      elements.statTotalDiscounts.textContent = `₹${calcDiscounts.toFixed(2)}`;
    }
  } catch (err) {
    console.error("History fetch error:", err);
  }
}

function renderHistoryList(transactions) {
  if (!transactions || transactions.length === 0) {
    elements.historyList.innerHTML = `<div class="empty-history"><span>🧾 No transactions recorded yet today</span></div>`;
    return;
  }

  elements.historyList.innerHTML = transactions.map(t => {
    const dateStr = t.created_at ? new Date(t.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    return `
      <div class="history-item">
        <div class="history-item-left">
          <h5>${t.customer_name || 'Discipl Member'}</h5>
          <span>${dateStr} ${t.invoice_number ? '• ' + t.invoice_number : ''}</span>
        </div>
        <div class="history-item-right">
          <div class="history-final-price">₹${parseFloat(t.final_amount || t.final_amount_payable || 0).toFixed(2)}</div>
          <div class="history-saved">Saved ₹${parseFloat(t.discount_amount || t.discount_saved || 0).toFixed(2)} (${t.discount_percentage || 0}%)</div>
        </div>
      </div>
    `;
  }).join('');
}
