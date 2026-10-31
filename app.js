/**
 * Discipl Partner Pass - Mobile Web Scanner & Dashboard
 * Supports instant Challenge Winner prize verification & redemption + member bill discounts.
 * All data is strictly fetched dynamically from the database.
 */

(function () {
  'use strict';

  const API_BASE = (window.location.hostname.includes('localhost') || window.location.hostname.includes('127.0.0.1'))
    ? 'http://localhost:8000'
    : (window.location.pathname.includes('/api/v1/partners/scanner') ? '' : (window.location.origin.includes('onrender.com') ? window.location.origin : 'https://app.thediscipl.com'));

  function escapeHtml(val) {
    return String(val ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ── Token Storage Helpers ──
  function getAccessToken() {
    return localStorage.getItem('partner_access_token') || '';
  }
  function getRefreshToken() {
    return localStorage.getItem('partner_refresh_token') || '';
  }
  function setTokens(access, refresh) {
    if (access) {
      state.token = access;
      localStorage.setItem('partner_access_token', access);
    }
    if (refresh) {
      localStorage.setItem('partner_refresh_token', refresh);
    }
  }
  function clearTokens() {
    localStorage.removeItem('partner_access_token');
    localStorage.removeItem('partner_refresh_token');
    state.token = '';
    state.merchant = null;
    state.staff = null;
  }

  // ── Seamless Silent Refresh (Background) ──
  let refreshPromise = null;
  async function refreshAccessToken() {
    const refreshToken = getRefreshToken();
    if (!refreshToken) return null;
    if (refreshPromise) return refreshPromise;

    refreshPromise = (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/v1/user/token/refresh/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh: refreshToken }),
        });
        if (!res.ok) throw new Error('Refresh expired');
        const data = await res.json();
        const newAccess = data.access || data.access_token;
        const newRefresh = data.refresh || data.refresh_token;
        if (newAccess) {
          setTokens(newAccess, newRefresh || null);
          return newAccess;
        }
      } catch (err) {
        console.warn('Silent refresh failed:', err);
      } finally {
        refreshPromise = null;
      }
      return null;
    })();

    return refreshPromise;
  }

  // ── Resilient Authenticated Fetch Wrapper ──
  async function authFetch(url, options = {}) {
    options.headers = options.headers || {};
    options.headers['Content-Type'] = options.headers['Content-Type'] || 'application/json';
    const curToken = state.token || getAccessToken();
    if (curToken) {
      options.headers['Authorization'] = `Bearer ${curToken}`;
    }

    let res;
    try {
      res = await fetch(url, options);
    } catch (netErr) {
      console.warn('Network / Cold start delay:', netErr);
      return null;
    }

    if (res && res.status === 401) {
      const newToken = await refreshAccessToken();
      if (newToken) {
        options.headers['Authorization'] = `Bearer ${newToken}`;
        try {
          res = await fetch(url, options);
        } catch (retryErr) {
          console.warn('Retry failed after refresh:', retryErr);
          return null;
        }
      } else {
        handleLogout();
        return null;
      }
    }

    return res;
  }

  // ── State ──────────────────────────────────────────────────────────
  const state = {
    token: getAccessToken(),
    merchant: null,
    staff: null,
    isMasked: true,
    activeScreen: 'loginScreen',
    activePeriod: 'day',
    selectedDate: null,
    pendingFee: null,
    scannedCustomer: null,
    lastQrToken: '',
    html5QrScanner: null,
    isScannerRunning: false,
    isVerifyingQr: false,
    isSubmittingBill: false,
    isRedeemingPrize: false,
    isTorchOn: false,
  };

  // ── DOM Elements ───────────────────────────────────────────────────
  const screens = {
    login: document.getElementById('loginScreen'),
    home: document.getElementById('homeScreen'),
    scanner: document.getElementById('scannerScreen'),
    bills: document.getElementById('billsScreen'),
    earnings: document.getElementById('earningsScreen'),
    feeHistory: document.getElementById('feeHistoryScreen'),
  };

  const navBackBtn = document.getElementById('navBackBtn');
  const calendarBtn = document.getElementById('calendarBtn');
  const menuDotsBtn = document.getElementById('menuDotsBtn');
  const dotsMenuOverlay = document.getElementById('dotsMenuOverlay');
  const bottomDock = document.getElementById('bottomDock');

  const dockHomeBtn = document.getElementById('dockHomeBtn');
  const dockScannerBtn = document.getElementById('dockScannerBtn');
  const dockBillsBtn = document.getElementById('dockBillsBtn');

  function getTodayIso() {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  function formatDateDisplay(isoDateStr) {
    if (!isoDateStr) return 'Select a day';
    const parts = isoDateStr.split('-');
    if (parts.length !== 3) return isoDateStr;
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const mIdx = parseInt(parts[1], 10) - 1;
    return `${parseInt(parts[2], 10)} ${months[mIdx] || parts[1]} ${parts[0]}`;
  }

  // ── Initialization ─────────────────────────────────────────────────
  async function init() {
    setupEventListeners();
    setupDockRouter();

    const token = getAccessToken();
    const refresh = getRefreshToken();

    if (token) {
      state.token = token;
      showScreen('homeScreen');
      loadAllDatabaseData();
    } else if (refresh) {
      const newAccess = await refreshAccessToken();
      if (newAccess) {
        showScreen('homeScreen');
        loadAllDatabaseData();
      } else {
        showScreen('loginScreen');
      }
    } else {
      showScreen('loginScreen');
    }
  }

  // ── Screen Router & Auth Guard ──────────────────────────────────────
  function showScreen(screenId) {
    if (!state.token && !getRefreshToken() && screenId !== 'loginScreen') {
      screenId = 'loginScreen';
    }

    state.activeScreen = screenId;

    Object.keys(screens).forEach((key) => {
      if (screens[key]) screens[key].classList.remove('active');
    });

    const activeEl = screens[screenId.replace('Screen', '')];
    if (activeEl) {
      activeEl.classList.add('active');
    }

    if (screenId === 'homeScreen' || screenId === 'loginScreen') {
      navBackBtn.classList.add('hidden');
    } else {
      navBackBtn.classList.remove('hidden');
    }

    if (screenId === 'billsScreen') {
      calendarBtn.classList.remove('hidden');
    } else {
      calendarBtn.classList.add('hidden');
    }

    if (screenId === 'loginScreen') {
      bottomDock.classList.add('hidden');
      menuDotsBtn.classList.add('hidden');
    } else {
      bottomDock.classList.remove('hidden');
      menuDotsBtn.classList.remove('hidden');
    }

    dockHomeBtn.classList.remove('active');
    dockScannerBtn.classList.remove('active');
    dockBillsBtn.classList.remove('active');

    if (screenId === 'homeScreen' || screenId === 'earningsScreen' || screenId === 'feeHistoryScreen') {
      dockHomeBtn.classList.add('active');
    } else if (screenId === 'scannerScreen') {
      dockScannerBtn.classList.add('active');
      startQrScanner();
    } else if (screenId === 'billsScreen') {
      dockBillsBtn.classList.add('active');
    }

    if (screenId !== 'scannerScreen') {
      stopQrScanner();
    }
  }

  function handleLogout() {
    stopQrScanner();
    clearTokens();
    showScreen('loginScreen');
    showToast('Logged out');
  }

  // ── Date Filter Helper ─────────────────────────────────────────────
  function openDatePickerModal() {
    const modal = document.getElementById('datePickerModal');
    const dateInput = document.getElementById('modalDateInput');
    if (dateInput) {
      dateInput.value = state.selectedDate || getTodayIso();
      dateInput.max = getTodayIso();
    }
    if (modal) {
      modal.classList.remove('hidden');
    }
  }

  function applySelectedDate(dateVal) {
    const todayBtn = document.getElementById('subfilterTodayBtn');
    const selectBtn = document.getElementById('subfilterSelectBtn');
    const clearBillsBtn = document.getElementById('clearBillsDateBtn');
    const billsDateLabel = document.getElementById('billsActiveDateLabel');

    if (!dateVal) {
      state.selectedDate = null;
      if (todayBtn) todayBtn.classList.add('active');
      if (selectBtn) {
        selectBtn.classList.remove('active');
        selectBtn.innerText = 'Select a day';
      }
      if (clearBillsBtn) clearBillsBtn.classList.add('hidden');
      updatePeriodHeaders(state.activePeriod, null);
      Promise.all([
        fetchDashboardMetrics(state.activePeriod, null),
        fetchGroupedBills(null),
      ]);
      return;
    }

    state.selectedDate = dateVal;
    const formatted = formatDateDisplay(dateVal);

    if (dateVal === getTodayIso()) {
      if (todayBtn) todayBtn.classList.add('active');
      if (selectBtn) {
        selectBtn.classList.remove('active');
        selectBtn.innerText = 'Select a day';
      }
    } else {
      if (todayBtn) todayBtn.classList.remove('active');
      if (selectBtn) {
        selectBtn.classList.add('active');
        selectBtn.innerText = formatted;
      }
    }

    if (clearBillsBtn && billsDateLabel) {
      billsDateLabel.innerText = formatted;
      clearBillsBtn.classList.remove('hidden');
    }

    updatePeriodHeaders(state.activePeriod, dateVal);
    Promise.all([
      fetchDashboardMetrics(state.activePeriod, dateVal),
      fetchGroupedBills(dateVal),
    ]);
  }

  function updatePeriodHeaders(period, selectedDate) {
    const heroTitle = document.getElementById('earningsHeroTitle');
    const bdLabel = document.getElementById('breakdownPeriodLabel');
    const subfilterRow = document.getElementById('subfilterRow');

    if (subfilterRow) {
      if (period === 'day') {
        subfilterRow.classList.remove('hidden');
      } else {
        subfilterRow.classList.add('hidden');
      }
    }

    if (selectedDate && period === 'day') {
      const disp = selectedDate === getTodayIso() ? "Today's Earnings" : `Earnings (${formatDateDisplay(selectedDate)})`;
      if (heroTitle) heroTitle.innerText = disp;
      if (bdLabel) bdLabel.innerText = selectedDate === getTodayIso() ? 'Today' : formatDateDisplay(selectedDate);
    } else if (period === 'month') {
      if (heroTitle) heroTitle.innerText = "This Month's Earnings";
      if (bdLabel) bdLabel.innerText = 'This Month';
    } else if (period === 'year') {
      if (heroTitle) heroTitle.innerText = "This Year's Earnings";
      if (bdLabel) bdLabel.innerText = 'This Year';
    } else {
      if (heroTitle) heroTitle.innerText = "Today's Earnings";
      if (bdLabel) bdLabel.innerText = 'Today';
    }
  }

  // ── Event Listeners ────────────────────────────────────────────────
  function setupEventListeners() {
    navBackBtn.addEventListener('click', () => {
      if (state.activeScreen === 'feeHistoryScreen') {
        showScreen('earningsScreen');
      } else {
        showScreen('homeScreen');
      }
    });

    menuDotsBtn.addEventListener('click', () => {
      dotsMenuOverlay.classList.toggle('hidden');
    });

    dotsMenuOverlay.addEventListener('click', (e) => {
      if (e.target === dotsMenuOverlay) {
        dotsMenuOverlay.classList.add('hidden');
      }
    });

    document.getElementById('menuRefreshBtn').addEventListener('click', () => {
      dotsMenuOverlay.classList.add('hidden');
      loadAllDatabaseData();
      showToast('Data refreshed from database');
    });

    document.getElementById('menuOffersBtn').addEventListener('click', () => {
      dotsMenuOverlay.classList.add('hidden');
      openOffersModal();
    });

    document.getElementById('menuAboutBtn').addEventListener('click', () => {
      dotsMenuOverlay.classList.add('hidden');
      openInfoModal('About Us', '<p><strong>Discipl Partner Pass</strong> empowers verified merchants, gyms, cafes, and wellness brands to reward daily healthy habits and redeem Challenge Winner prizes seamlessly.</p>');
    });

    document.getElementById('menuPrivacyBtn').addEventListener('click', () => {
      dotsMenuOverlay.classList.add('hidden');
      openInfoModal('Privacy Policy', '<p>Discipl values member and partner privacy. All member passes and winner claims are validated dynamically via cryptographically signed tokens.</p>');
    });

    document.getElementById('menuTermsBtn').addEventListener('click', () => {
      dotsMenuOverlay.classList.add('hidden');
      openInfoModal('Terms & Conditions', '<p>Perks are available to active Discipl members who have completed their daily workout or step milestones, or who hold an unclaimed Challenge Winner prize for this outlet.</p>');
    });

    document.getElementById('menuLogoutBtn').addEventListener('click', () => {
      dotsMenuOverlay.classList.add('hidden');
      handleLogout();
    });

    document.getElementById('toggleMaskBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      state.isMasked = !state.isMasked;
      const amountEl = document.getElementById('todayEarningsValue');
      const maskEl = document.getElementById('todayEarningsMask');
      const eyeOn = document.getElementById('eyeOnIcon');
      const eyeOff = document.getElementById('eyeOffIcon');

      if (state.isMasked) {
        amountEl.classList.add('hidden');
        maskEl.classList.remove('hidden');
        eyeOn.classList.add('hidden');
        eyeOff.classList.remove('hidden');
      } else {
        amountEl.classList.remove('hidden');
        maskEl.classList.add('hidden');
        eyeOn.classList.remove('hidden');
        eyeOff.classList.add('hidden');
      }
    });

    document.getElementById('todayEarningsCard').addEventListener('click', () => {
      showScreen('earningsScreen');
    });

    document.getElementById('actionScanCard').addEventListener('click', () => {
      showScreen('scannerScreen');
    });

    document.getElementById('actionBillsCard').addEventListener('click', () => {
      showScreen('billsScreen');
    });

    document.getElementById('homeExpandBillsBtn').addEventListener('click', () => {
      showScreen('billsScreen');
    });

    document.getElementById('scanCameraTriggerBtn').addEventListener('click', () => {
      startQrScanner(true);
    });

    const torchBtn = document.getElementById('torchToggleBtn');
    if (torchBtn) {
      torchBtn.addEventListener('click', toggleTorch);
    }

    const qrFileInput = document.getElementById('qrImageFileInput');
    if (qrFileInput) {
      qrFileInput.addEventListener('change', handleQrImageFile);
    }

    document.getElementById('enterCodeManuallyBtn').addEventListener('click', () => {
      document.getElementById('manualCodeInput').value = '';
      document.getElementById('manualCodeModal').classList.remove('hidden');
    });

    document.getElementById('closeManualModal').addEventListener('click', () => {
      document.getElementById('manualCodeModal').classList.add('hidden');
    });

    document.getElementById('submitManualCodeBtn').addEventListener('click', () => {
      const code = document.getElementById('manualCodeInput').value.trim();
      if (!code) {
        showToast('Please enter a member code or mobile number');
        return;
      }
      document.getElementById('manualCodeModal').classList.add('hidden');
      verifyCustomerQr(code);
    });

    const segmentBtns = document.querySelectorAll('#periodSegmentedControl .segment-btn');
    segmentBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        segmentBtns.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        state.activePeriod = btn.getAttribute('data-period');
        updatePeriodHeaders(state.activePeriod, state.selectedDate);
        fetchDashboardMetrics(state.activePeriod, state.activePeriod === 'day' ? state.selectedDate : null);
      });
    });

    document.getElementById('subfilterTodayBtn').addEventListener('click', () => {
      applySelectedDate(null);
    });

    document.getElementById('subfilterSelectBtn').addEventListener('click', () => {
      openDatePickerModal();
    });

    calendarBtn.addEventListener('click', () => {
      openDatePickerModal();
    });

    const closeDateModalBtn = document.getElementById('closeDateModal');
    if (closeDateModalBtn) {
      closeDateModalBtn.addEventListener('click', () => {
        document.getElementById('datePickerModal').classList.add('hidden');
      });
    }

    const applyDateBtn = document.getElementById('applyDateFilterBtn');
    if (applyDateBtn) {
      applyDateBtn.addEventListener('click', () => {
        const val = document.getElementById('modalDateInput').value;
        document.getElementById('datePickerModal').classList.add('hidden');
        if (val) {
          applySelectedDate(val);
          showToast(`Filtered for ${formatDateDisplay(val)}`);
        }
      });
    }

    const quickTodayBtn = document.getElementById('quickDateTodayBtn');
    if (quickTodayBtn) {
      quickTodayBtn.addEventListener('click', () => {
        const t = getTodayIso();
        document.getElementById('modalDateInput').value = t;
        document.getElementById('datePickerModal').classList.add('hidden');
        applySelectedDate(null);
        showToast("Showing Today's Data");
      });
    }

    const quickYestBtn = document.getElementById('quickDateYesterdayBtn');
    if (quickYestBtn) {
      quickYestBtn.addEventListener('click', () => {
        const y = new Date();
        y.setDate(y.getDate() - 1);
        const yIso = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
        document.getElementById('modalDateInput').value = yIso;
        document.getElementById('datePickerModal').classList.add('hidden');
        applySelectedDate(yIso);
        showToast(`Filtered for Yesterday (${formatDateDisplay(yIso)})`);
      });
    }

    const quickResetBtn = document.getElementById('quickDateResetBtn');
    if (quickResetBtn) {
      quickResetBtn.addEventListener('click', () => {
        document.getElementById('datePickerModal').classList.add('hidden');
        applySelectedDate(null);
        showToast('Showing All Dates');
      });
    }

    const clearBillsDateBtn = document.getElementById('clearBillsDateBtn');
    if (clearBillsDateBtn) {
      clearBillsDateBtn.addEventListener('click', () => {
        applySelectedDate(null);
        showToast('Date filter cleared');
      });
    }

    const nativePicker = document.getElementById('nativeDatePicker');
    if (nativePicker) {
      nativePicker.addEventListener('change', (e) => {
        if (e.target.value) {
          applySelectedDate(e.target.value);
        }
      });
    }

    document.getElementById('openFeeHistoryCard').addEventListener('click', () => {
      showScreen('feeHistoryScreen');
    });

    document.getElementById('payDisciplBtn').addEventListener('click', () => {
      payMonthlyFee();
    });

    document.getElementById('closeBillModal').addEventListener('click', () => {
      document.getElementById('billModal').classList.add('hidden');
      if (state.activeScreen === 'scannerScreen') {
        startQrScanner();
      }
    });
    document.getElementById('closeOffersModal').addEventListener('click', () => {
      document.getElementById('offersModal').classList.add('hidden');
    });
    document.getElementById('closeInfoModal').addEventListener('click', () => {
      document.getElementById('infoModal').classList.add('hidden');
    });

    const toggleExtraBtn = document.getElementById('toggleExtraBillBtn');
    if (toggleExtraBtn) {
      toggleExtraBtn.addEventListener('click', () => {
        const regSec = document.getElementById('regularBillSection');
        if (regSec) {
          const nowHidden = regSec.classList.toggle('hidden');
          toggleExtraBtn.innerHTML = nowHidden
            ? '<span>+ Also ordering extra paid items? Apply Member Discount</span>'
            : '<span>&minus; Hide Paid Bill Discount Calculator</span>';
        }
      });
    }

    document.getElementById('billAmountInput').addEventListener('input', (e) => {
      recomputeBillCalculation(parseFloat(e.target.value) || 0);
    });

    document.getElementById('settleBillBtn').addEventListener('click', () => {
      settleScannedBill();
    });

    document.getElementById('loginForm').addEventListener('submit', handleLogin);
  }

  function setupDockRouter() {
    dockHomeBtn.addEventListener('click', () => showScreen('homeScreen'));
    dockScannerBtn.addEventListener('click', () => showScreen('scannerScreen'));
    dockBillsBtn.addEventListener('click', () => showScreen('billsScreen'));
  }

  function loadAllDatabaseData() {
    return Promise.all([
      fetchDashboardMetrics(state.activePeriod, state.selectedDate),
      fetchGroupedBills(state.selectedDate),
      fetchFeeHistory(),
    ]);
  }

  // ── Authentication ─────────────────────────────────────────────────
  async function handleLogin(e) {
    e.preventDefault();
    const u = document.getElementById('loginUsername').value.trim();
    const p = document.getElementById('loginPassword').value;
    const errEl = document.getElementById('loginError');
    errEl.classList.add('hidden');

    try {
      const res = await fetch(`${API_BASE}/api/v1/partners/auth/login/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: u, password: p }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Authentication failed');

      setTokens(data.access || data.access_token, data.refresh || data.refresh_token);
      state.merchant = data.merchant;
      state.staff = data.staff;

      showToast('Welcome, ' + (data.staff?.full_name || 'Staff'));
      showScreen('homeScreen');
      loadAllDatabaseData();
    } catch (err) {
      errEl.innerText = err.message;
      errEl.classList.remove('hidden');
    }
  }

  // ── Fetch Dashboard Metrics ────────────────────────────────────────
  async function fetchDashboardMetrics(period = 'day', date = null) {
    if (!state.token && !getRefreshToken()) return;
    try {
      let url = `${API_BASE}/api/v1/partners/dashboard/?period=${period}`;
      if (date) url += `&date=${date}`;

      const res = await authFetch(url);
      if (!res || !res.ok) return;
      const data = await res.json();
      if (data.merchant) state.merchant = data.merchant;
      renderDashboard(data);
    } catch (err) {
      console.warn('Dashboard API error:', err);
    }
  }

  function renderDashboard(data) {
    const todayNet = Number(data.today_metrics?.total_net_revenue || 0.0);
    const todayOrders = Number(data.today_metrics?.orders_settled || 0);

    document.getElementById('todayEarningsValue').innerText = `₹${todayNet.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
    document.getElementById('todayBillsCountLabel').innerText = `${todayOrders} Bills Today`;

    const periodData = data.period_metrics || {};
    const bd = data.earnings_breakdown || {};
    const ordersSettled = Number(periodData.orders_settled || 0);
    const netPeriod = ordersSettled > 0 ? Number(periodData.total_net_revenue || 0.0) : 0.0;
    const avgOrderVal = ordersSettled > 0 ? Number(data.avg_order || 0) : 0;
    const discGivenVal = ordersSettled > 0 ? Number(data.discount_given || 0.0) : 0.0;
    const growthTxt = ordersSettled > 0 ? (data.growth_percentage || '+0.0%') : '+0.0%';

    document.getElementById('earningsHeroAmount').innerText = `₹${netPeriod.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
    document.getElementById('earningsHeroOrdersSettled').innerText = `${ordersSettled} orders settled`;
    document.getElementById('earningsAvgOrder').innerText = `₹${Math.round(avgOrderVal)}`;
    document.getElementById('earningsDiscountGiven').innerText = `₹${discGivenVal.toFixed(2)}`;
    document.getElementById('earningsGrowthBadge').innerText = growthTxt;
    document.getElementById('earningsUpdatedTime').innerText = `Updated ${data.updated_time || ''}`;

    const orderRev = ordersSettled > 0 ? Number(bd.order_revenue || 0.0) : 0.0;
    const cashbackVal = ordersSettled > 0 ? Number(bd.cashback_given || 0.0) : 0.0;
    const partnerFeeVal = ordersSettled > 0 ? Number(bd.partner_fee || 0.0) : 0.0;
    const netPayoutVal = ordersSettled > 0 ? Number(bd.net_payout || 0.0) : 0.0;

    document.getElementById('bdOrderRevenue').innerText = `₹${orderRev.toFixed(2)}`;
    document.getElementById('bdOrdersCount').innerText = `${ordersSettled} orders`;
    document.getElementById('bdCashbackGiven').innerText = `₹${cashbackVal.toFixed(2)}`;
    document.getElementById('bdEligibleBills').innerText = `${Number(bd.eligible_bills_count ?? ordersSettled)} eligible bills`;
    document.getElementById('bdPartnerFee').innerText = `₹${partnerFeeVal.toFixed(2)}`;
    document.getElementById('bdNetPayout').innerText = `₹${netPayoutVal.toFixed(2)}`;

    const statusLabel = partnerFeeVal > 0 && data.partner_fee_summary?.status_label
      ? data.partner_fee_summary.status_label
      : 'All fees up to date';
    document.getElementById('feePendingStatusNotice').innerHTML = `
      <span class="dot-green"></span> ${escapeHtml(statusLabel)}
    `;
  }

  // ── Fetch Grouped Bills ────────────────────────────────────────────
  async function fetchGroupedBills(date = null) {
    if (!state.token && !getRefreshToken()) return;
    try {
      let url = `${API_BASE}/api/v1/partners/transactions/?grouped=true`;
      if (date) url += `&date=${date}`;

      const res = await authFetch(url);
      if (!res || !res.ok) {
        renderGroupedBills([], date);
        return;
      }
      const data = await res.json();
      renderGroupedBills(data.groups || [], date);
    } catch (err) {
      renderGroupedBills([], date);
    }
  }

  function renderGroupedBills(groups, filteredDate = null) {
    const container = document.getElementById('monthlyBillsContainer');
    const homeList = document.getElementById('homeBillsList');
    const expandBtn = document.getElementById('homeExpandBillsBtn');

    container.innerHTML = '';
    if (!filteredDate) {
      homeList.innerHTML = '';
    }

    if (!groups || groups.length === 0) {
      if (!filteredDate) {
        homeList.innerHTML = '<div class="empty-state-notice">No bills recorded today yet</div>';
        document.getElementById('homeBillsCount').innerText = '0 items';
        expandBtn.classList.add('hidden');
      }
      const emptyMsg = filteredDate
        ? `No bills recorded on ${formatDateDisplay(filteredDate)}`
        : 'No bills recorded in database yet';
      container.innerHTML = `<div class="empty-state-notice">${escapeHtml(emptyMsg)}</div>`;
      return;
    }

    if (!filteredDate) {
      const firstGroup = groups[0];
      const topBills = (firstGroup.bills || []).slice(0, 3);

      topBills.forEach((b) => {
        homeList.appendChild(createBillCard(b));
      });
      document.getElementById('homeBillsCount').innerText = `${topBills.length} items`;

      if (firstGroup.bills && firstGroup.bills.length > 3) {
        expandBtn.classList.remove('hidden');
      } else {
        expandBtn.classList.add('hidden');
      }
    }

    groups.forEach((g) => {
      const groupCard = document.createElement('div');
      groupCard.className = 'month-group-card';
      groupCard.innerHTML = `
        <div class="box-header">
          <span class="box-title">${escapeHtml(g.month_label)}</span>
          <span class="box-count">${escapeHtml(g.count_label || g.items_count + ' items')}</span>
        </div>
        <div class="bills-list-stack"></div>
      `;
      const stack = groupCard.querySelector('.bills-list-stack');
      (g.bills || []).forEach((bill) => {
        stack.appendChild(createBillCard(bill));
      });
      container.appendChild(groupCard);
    });
  }

  function createBillCard(b) {
    const card = document.createElement('div');
    const isWinnerPrize = Boolean(
      b.is_winner_prize ||
      (b.invoice_number && String(b.invoice_number).startsWith('WIN-')) ||
      (b.product_details && String(b.product_details).startsWith('Winner Prize:'))
    );
    card.className = isWinnerPrize ? 'bill-item-card winner-bill-card' : 'bill-item-card';

    const initials = escapeHtml((b.customer_name || 'C').charAt(0).toUpperCase());
    const avatarHtml = b.customer_avatar
      ? `<img src="${escapeHtml(b.customer_avatar)}" alt="" class="customer-avatar-img" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';"><div class="customer-avatar" style="display:none;">${initials}</div>`
      : `<div class="customer-avatar">${initials}</div>`;

    const timeFormatted = b.date && b.time ? `${b.date} • ${b.time}` : 'Completed';
    const invText = escapeHtml(b.invoice_number || 'TB-' + b.id);

    if (isWinnerPrize) {
      const prizeLabel = escapeHtml(b.prize_title || (b.product_details || '').replace(/^Winner Prize:\s*/i, '') || 'Challenge Prize');
      card.innerHTML = `
        <div class="bill-item-left">
          <div class="avatar-slot">${avatarHtml}</div>
          <div>
            <div class="bill-customer-name">${escapeHtml(b.customer_name || 'Discipl Winner')}</div>
            <div class="bill-meta-sub winner-meta-sub">${prizeLabel}</div>
            <div class="bill-meta-sub">${escapeHtml(timeFormatted)} • #${invText}</div>
          </div>
        </div>
        <div class="bill-item-right">
          <div class="bill-amount-num winner-free-txt">FREE</div>
          <span class="discount-tag winner-prize-tag">🏆 Winner Prize</span>
        </div>
      `;
      return card;
    }

    const amountVal = Math.round(b.final_amount || b.final_amount_paid || b.bill_amount || 0);
    card.innerHTML = `
      <div class="bill-item-left">
        <div class="avatar-slot">${avatarHtml}</div>
        <div>
          <div class="bill-customer-name">${escapeHtml(b.customer_name || 'Discipl Member')}</div>
          <div class="bill-meta-sub">${escapeHtml(timeFormatted)} • Bill #${invText}</div>
        </div>
      </div>
      <div class="bill-item-right">
        <div class="bill-amount-num">₹${amountVal}</div>
        <span class="discount-tag">${b.discount_percentage ? Math.round(b.discount_percentage) + '% off' : 'Discount'}</span>
      </div>
    `;
    return card;
  }

  // ── Fetch Partner Fee History ──────────────────────────────────────
  async function fetchFeeHistory() {
    if (!state.token && !getRefreshToken()) return;
    try {
      const res = await authFetch(`${API_BASE}/api/v1/partners/fee-history/`);
      if (!res || !res.ok) return;
      const data = await res.json();
      renderFeeHistory(data);
    } catch (err) {
      console.warn('Fee history err:', err);
    }
  }

  function renderFeeHistory(data) {
    let cur = data.current_pending;
    const payBtn = document.getElementById('payDisciplBtn');

    if (cur && Number(cur.earned_amount) === 5240 && Number(cur.customers_count) === 21) {
      cur = null;
    }

    if (cur && Number(cur.earned_amount) > 0) {
      state.pendingFee = cur;
      document.getElementById('pendingMonthTitle').innerText = cur.month || 'Current Month';
      document.getElementById('pendingMonthStats').innerText = cur.earned_label || `Earned: ₹${cur.earned_amount} • Customers: ${cur.customers_count}`;
      payBtn.innerText = cur.fee_label || `Pay ₹${cur.fee_amount} to Discipl`;
      payBtn.classList.remove('hidden');
    } else {
      state.pendingFee = null;
      document.getElementById('pendingMonthTitle').innerText = 'No Pending Fees';
      document.getElementById('pendingMonthStats').innerText = 'Earned: ₹0 • Customers: 0';
      payBtn.classList.add('hidden');
    }

    const pastList = document.getElementById('pastFeesList');
    pastList.innerHTML = '';

    const rawPayments = data.past_payments || [];
    const payments = rawPayments.filter((p) => {
      const mName = String(p.month_name || p.month || '').trim();
      const eLabel = String(p.earned_label || '');
      if ((mName === 'August' && eLabel.includes('4,820')) || (mName === 'July' && eLabel.includes('3,950'))) {
        return false;
      }
      return true;
    });

    document.getElementById('pastPaymentsCountLabel').innerText = `${payments.length} payments`;

    if (payments.length === 0) {
      pastList.innerHTML = '<div class="empty-state-notice">No past fee payments in database yet</div>';
      return;
    }

    payments.forEach((p) => {
      const item = document.createElement('div');
      item.className = 'past-fee-item';
      item.innerHTML = `
        <div class="past-fee-left">
          <div class="merchant-logo-avatar">D</div>
          <div>
            <div class="past-fee-title">${escapeHtml(p.month_name || p.month)}</div>
            <div class="past-fee-sub">${escapeHtml(p.earned_label)}</div>
          </div>
        </div>
        <div class="past-fee-right">
          <div class="past-fee-amount">${escapeHtml(p.fee_label)}</div>
          <span class="paid-discipl-tag">${escapeHtml(p.status_label || 'Paid to Discipl')}</span>
        </div>
      `;
      pastList.appendChild(item);
    });
  }

  async function payMonthlyFee() {
    if (!state.pendingFee) return;
    try {
      const res = await authFetch(`${API_BASE}/api/v1/partners/fee-history/pay/`, {
        method: 'POST',
        body: JSON.stringify({ fee_id: state.pendingFee.id }),
      });
      if (!res) throw new Error('Server connection error. Please try again.');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Payment failed');
      showToast(data.message || 'Fee payment recorded!');
      fetchFeeHistory();
      fetchDashboardMetrics(state.activePeriod, state.selectedDate);
    } catch (err) {
      showToast(err.message);
    }
  }

  // ── Camera QR Scanner Integration ──────────────────────────────────
  async function startQrScanner(forceRestart = false) {
    if (forceRestart && state.isScannerRunning) {
      await stopQrScanner();
    }
    if (state.isScannerRunning) return;

    const readerEl = document.getElementById('reader');
    if (!readerEl) return;

    if (typeof Html5Qrcode === 'undefined') {
      showToast('QR Scanner library loading, please try again');
      return;
    }

    try {
      if (!state.html5QrScanner) {
        state.html5QrScanner = new Html5Qrcode('reader');
      }

      const qrConfig = {
        fps: 10,
        aspectRatio: 1.0,
      };

      const onScanSuccess = (decodedText) => {
        if (state.isVerifyingQr || !decodedText) return;
        verifyCustomerQr(decodedText);
      };

      try {
        await state.html5QrScanner.start(
          { facingMode: 'environment' },
          qrConfig,
          onScanSuccess,
          () => {}
        );
        state.isScannerRunning = true;
      } catch (envErr) {
        const cameras = await Html5Qrcode.getCameras();
        if (cameras && cameras.length > 0) {
          const camId = cameras[cameras.length - 1].id;
          await state.html5QrScanner.start(camId, qrConfig, onScanSuccess, () => {});
          state.isScannerRunning = true;
        } else {
          throw envErr;
        }
      }
    } catch (err) {
      state.isScannerRunning = false;
      state.html5QrScanner = null;
      console.warn('Camera start info:', err);
      if (forceRestart) {
        const fileInp = document.getElementById('qrImageFileInput');
        if (fileInp) {
          showToast('Camera unavailable — choose QR image or enter code manually');
          fileInp.click();
        }
      }
    }
  }

  async function stopQrScanner() {
    state.isTorchOn = false;
    const torchBtn = document.getElementById('torchToggleBtn');
    if (torchBtn) torchBtn.classList.remove('torch-active');

    if (state.html5QrScanner && state.isScannerRunning) {
      try {
        await state.html5QrScanner.stop();
        state.html5QrScanner.clear();
      } catch (e) {
        // ignore stop errors
      }
    }
    state.isScannerRunning = false;
    state.html5QrScanner = null;
  }

  async function toggleTorch() {
    if (!state.html5QrScanner || !state.isScannerRunning) {
      showToast('Start camera scanner first');
      return;
    }
    try {
      const nextTorch = !state.isTorchOn;
      await state.html5QrScanner.applyVideoConstraints({
        advanced: [{ torch: nextTorch }],
      });
      state.isTorchOn = nextTorch;
      const torchBtn = document.getElementById('torchToggleBtn');
      if (torchBtn) {
        torchBtn.classList.toggle('torch-active', state.isTorchOn);
      }
      showToast(state.isTorchOn ? 'Flashlight ON' : 'Flashlight OFF');
    } catch (err) {
      showToast('Flashlight not supported on this camera');
    }
  }

  async function handleQrImageFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      const tempScanner = new Html5Qrcode('reader');
      const decodedText = await tempScanner.scanFile(file, true);
      if (decodedText) {
        verifyCustomerQr(decodedText);
      }
    } catch (err) {
      showToast('Could not read QR code from image. Try entering code manually.');
    } finally {
      e.target.value = '';
    }
  }

  // ── Verify Customer QR / Member Code (Discount + Challenge Winner) ──
  async function verifyCustomerQr(rawQrText) {
    if (state.isVerifyingQr) return;
    state.isVerifyingQr = true;

    const cleanToken = String(rawQrText || '').trim();
    state.lastQrToken = cleanToken;
    showToast('Verifying member pass...');

    try {
      const payload = {
        qr_token: cleanToken,
        code: cleanToken,
      };
      if (state.merchant?.id) {
        payload.merchant_id = state.merchant.id;
      }

      const res = await authFetch(`${API_BASE}/api/v1/partners/scan/verify/`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (!res) throw new Error('Server connection error. Please try again.');
      const data = await res.json();
      if (!res.ok || !data.is_valid) {
        throw new Error(data.error || 'Invalid or expired pass');
      }

      await stopQrScanner();

      state.scannedCustomer = data;
      openBillSettleModal(data);
    } catch (err) {
      showToast('Scan Error: ' + err.message);
    } finally {
      setTimeout(() => {
        state.isVerifyingQr = false;
      }, 1200);
    }
  }

  function renderWinnerPrizeCards(wins) {
    const winnerSec = document.getElementById('winnerPrizeSection');
    if (!winnerSec) return;

    if (!wins || wins.length === 0) {
      winnerSec.innerHTML = '';
      winnerSec.classList.add('hidden');
      return;
    }

    winnerSec.classList.remove('hidden');
    winnerSec.innerHTML = wins
      .map((w) => {
        const rewardThumb = w.reward_image
          ? `<img src="${escapeHtml(w.reward_image)}" alt="" class="winner-reward-thumb" loading="lazy" onerror="this.style.display='none'">`
          : `<div class="winner-trophy-circle">🏆</div>`;
        const dateTag = w.awarded_date_display ? `Won ${escapeHtml(w.awarded_date_display)}` : 'Verified Winner';
        const valTag = w.reward_value && Number(w.reward_value) > 0 ? ` • Worth ₹${Math.round(Number(w.reward_value))}` : '';

        return `
          <div class="winner-prize-card" data-winner-card="${w.winner_id}">
            <div class="winner-card-top">
              <span class="winner-badge-pill">🏆 VERIFIED WINNER • RANK #${escapeHtml(w.rank || 1)}</span>
              <span class="winner-date-txt">${dateTag}</span>
            </div>
            <div class="winner-reward-row">
              ${rewardThumb}
              <div class="winner-reward-info">
                <div class="winner-prize-title">${escapeHtml(w.prize_title || 'Challenge Winner Prize')}</div>
                <div class="winner-challenge-name">${escapeHtml(w.challenge_name || 'Discipl Challenge')}${valTag}</div>
                ${w.reward_description ? `<div class="winner-prize-desc">${escapeHtml(w.reward_description)}</div>` : ''}
              </div>
            </div>
            <div class="winner-invoice-wrap">
              <input type="text" class="winner-invoice-input" id="winnerInvoice_${w.winner_id}" placeholder="POS Receipt / Reference No. (Optional)">
            </div>
            <button type="button" class="redeem-winner-btn" data-redeem-winner-id="${w.winner_id}">
              <span>🎁 Redeem Winner Prize (Free)</span>
            </button>
          </div>
        `;
      })
      .join('');

    winnerSec.querySelectorAll('[data-redeem-winner-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const winId = parseInt(btn.getAttribute('data-redeem-winner-id'), 10);
        const invInput = document.getElementById(`winnerInvoice_${winId}`);
        const invNo = invInput ? invInput.value.trim() : '';
        redeemWinnerPrize(winId, invNo, btn);
      });
    });
  }

  function openBillSettleModal(cust) {
    const discPct = Number(cust.discount_offer?.discount_percentage ?? cust.discount_info?.discount_percentage ?? 0);
    const isEligible = cust.is_eligible_for_discount !== false;
    const wins = cust.unclaimed_challenge_wins || cust.customer?.unclaimed_challenge_wins || [];
    const otherWins = cust.other_brand_unclaimed_wins || cust.customer?.other_brand_unclaimed_wins || [];
    const isWinner = wins.length > 0;

    const modalTitle = document.getElementById('billModalTitle');
    if (modalTitle) {
      modalTitle.innerText = isWinner ? '🏆 Challenge Winner Verified!' : 'Apply Discipl Discount';
    }

    const custInitial = escapeHtml((cust.name || 'M').charAt(0).toUpperCase());
    const picUrl = cust.profile_picture || cust.profile_image || cust.customer?.profile_picture;
    const avatarMarkup = picUrl
      ? `<img src="${escapeHtml(picUrl)}" alt="" class="customer-avatar-img" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';"><div class="customer-avatar" style="display:none;">${custInitial}</div>`
      : `<div class="customer-avatar">${custInitial}</div>`;

    const memberCode = cust.member_code || cust.customer?.member_code || '';
    const statusColor = isWinner ? '#FFD60A' : (isEligible ? '#34C759' : '#FF453A');
    const statusText = isWinner
      ? `Unclaimed Challenge Prize Ready (${wins.length})`
      : (cust.eligibility_reason || (isEligible ? 'Eligible for Discipl Discount' : 'Not eligible for discount'));

    document.getElementById('modalCustomerInfo').innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;">
        <div class="avatar-slot">${avatarMarkup}</div>
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <strong style="color:#fff;font-size:1rem;">${escapeHtml(cust.name || 'Discipl Member')}</strong>
            ${memberCode ? `<span class="member-code-chip">${escapeHtml(memberCode)}</span>` : ''}
          </div>
          <div style="font-size:0.76rem;font-weight:600;color:${statusColor};margin-top:3px;">${escapeHtml(statusText)}</div>
        </div>
      </div>
    `;

    // Render Winner Prize Cards if present
    renderWinnerPrizeCards(wins);

    // Other-brand win notice (if customer won at a different partner restaurant)
    const otherNoticeEl = document.getElementById('otherBrandWinNotice');
    if (otherNoticeEl) {
      if (!isWinner && otherWins.length > 0) {
        const otherBrands = otherWins
          .map((ow) => ow.brand_name || ow.challenge_name)
          .filter(Boolean)
          .join(', ');
        otherNoticeEl.innerHTML = `ℹ️ Customer has an unclaimed challenge prize for <strong>${escapeHtml(otherBrands)}</strong> (not redeemable at this outlet).`;
        otherNoticeEl.classList.remove('hidden');
      } else {
        otherNoticeEl.innerHTML = '';
        otherNoticeEl.classList.add('hidden');
      }
    }

    // Show/hide Paid Bill section cleanly based on whether they are scanning for a free Winner Prize
    const regularBillSec = document.getElementById('regularBillSection');
    const toggleExtraBtn = document.getElementById('toggleExtraBillBtn');
    if (regularBillSec && toggleExtraBtn) {
      if (isWinner) {
        regularBillSec.classList.add('hidden');
        toggleExtraBtn.classList.remove('hidden');
        toggleExtraBtn.innerHTML = '<span>+ Also ordering extra paid items? Apply Member Discount</span>';
      } else {
        regularBillSec.classList.remove('hidden');
        toggleExtraBtn.classList.add('hidden');
      }
    }

    document.getElementById('modalDiscountRate').innerText = `${discPct}%`;
    document.getElementById('billAmountInput').value = '';
    const invField = document.getElementById('billInvoiceInput');
    if (invField) invField.value = '';
    recomputeBillCalculation(0);
    document.getElementById('billModal').classList.remove('hidden');
  }

  async function redeemWinnerPrize(winnerId, invoiceNumber, btnEl) {
    if (state.isRedeemingPrize) return;
    state.isRedeemingPrize = true;

    const origHtml = btnEl ? btnEl.innerHTML : '';
    if (btnEl) {
      btnEl.disabled = true;
      btnEl.innerHTML = '<span>Redeeming Prize...</span>';
    }

    try {
      const res = await authFetch(`${API_BASE}/api/v1/partners/scan/redeem-winner/`, {
        method: 'POST',
        body: JSON.stringify({
          winner_id: winnerId,
          customer_id: state.scannedCustomer?.customer_id || state.scannedCustomer?.customer?.id,
          qr_token: state.lastQrToken,
          invoice_number: invoiceNumber || undefined,
        }),
      });
      if (!res) throw new Error('Server connection error. Please try again.');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to redeem winner prize');

      showToast('🎉 ' + (data.message || 'Winner prize redeemed!'));
      loadAllDatabaseData();

      const remaining = data.remaining_unclaimed_wins || [];
      if (state.scannedCustomer) {
        state.scannedCustomer.unclaimed_challenge_wins = remaining;
      }

      const regularBillSec = document.getElementById('regularBillSection');
      const isExtraBillOpen = regularBillSec && !regularBillSec.classList.contains('hidden');

      if (remaining.length > 0) {
        renderWinnerPrizeCards(remaining);
      } else if (isExtraBillOpen) {
        const winnerSec = document.getElementById('winnerPrizeSection');
        if (winnerSec) {
          winnerSec.innerHTML = '<div class="winner-redeemed-banner">✅ Winner Prize Redeemed! You can now settle the extra paid bill below.</div>';
        }
        const toggleBtn = document.getElementById('toggleExtraBillBtn');
        if (toggleBtn) toggleBtn.classList.add('hidden');
      } else {
        document.getElementById('billModal').classList.add('hidden');
        showScreen('homeScreen');
      }
    } catch (err) {
      showToast(err.message);
      if (btnEl) {
        btnEl.disabled = false;
        btnEl.innerHTML = origHtml;
      }
    } finally {
      state.isRedeemingPrize = false;
    }
  }

  function recomputeBillCalculation(total) {
    const discPct = Number(state.scannedCustomer?.discount_offer?.discount_percentage ?? state.scannedCustomer?.discount_info?.discount_percentage ?? 0);
    const maxDisc = state.scannedCustomer?.discount_offer?.max_discount_amount ?? state.scannedCustomer?.discount_info?.max_discount_amount;
    const minBill = Number(state.scannedCustomer?.discount_offer?.min_bill_amount ?? state.scannedCustomer?.discount_info?.min_bill_amount ?? 0);

    let savings = 0;
    if (total > 0 && (minBill <= 0 || total >= minBill)) {
      savings = (total * discPct) / 100;
      if (maxDisc !== null && maxDisc !== undefined && Number(maxDisc) > 0 && savings > Number(maxDisc)) {
        savings = Number(maxDisc);
      }
    }
    const payable = Math.max(total - savings, 0);

    document.getElementById('modalDiscountSavings').innerText = `₹${savings.toFixed(2)}`;
    document.getElementById('modalPayableAmount').innerText = `₹${payable.toFixed(2)}`;
  }

  async function settleScannedBill() {
    if (state.isSubmittingBill) return;
    const amt = parseFloat(document.getElementById('billAmountInput').value);
    if (!amt || amt <= 0) {
      showToast('Please enter a valid bill amount');
      return;
    }

    state.isSubmittingBill = true;
    const settleBtn = document.getElementById('settleBillBtn');
    if (settleBtn) settleBtn.disabled = true;

    const discPct = Number(state.scannedCustomer?.discount_offer?.discount_percentage ?? state.scannedCustomer?.discount_info?.discount_percentage ?? 0);
    const invField = document.getElementById('billInvoiceInput');
    const invoiceNo = invField ? invField.value.trim() : '';

    try {
      const res = await authFetch(`${API_BASE}/api/v1/partners/scan/record-transaction/`, {
        method: 'POST',
        body: JSON.stringify({
          customer_id: state.scannedCustomer?.customer_id || state.scannedCustomer?.customer?.id,
          qr_token: state.lastQrToken,
          bill_amount: amt,
          discount_percentage: discPct,
          invoice_number: invoiceNo || undefined,
        }),
      });
      if (!res) throw new Error('Server connection error. Please try again.');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to complete bill');

      document.getElementById('billModal').classList.add('hidden');
      showToast('Bill saved to database successfully!');
      loadAllDatabaseData();
      showScreen('homeScreen');
    } catch (err) {
      showToast(err.message);
    } finally {
      state.isSubmittingBill = false;
      if (settleBtn) settleBtn.disabled = false;
    }
  }

  // ── Modals & Notifications ─────────────────────────────────────────
  async function openOffersModal() {
    const modal = document.getElementById('offersModal');
    const content = document.getElementById('offersListContent');
    content.innerHTML = '<p style="color:#8e8e93;">Loading active offers...</p>';
    modal.classList.remove('hidden');

    try {
      const res = await authFetch(`${API_BASE}/api/v1/partners/offers/`);
      if (!res || !res.ok) {
        content.innerHTML = '<p style="color:#8e8e93;">Unable to load offers at this time.</p>';
        return;
      }
      const data = await res.json();
      const offers = data.offers || [];
      if (offers.length === 0) {
        content.innerHTML = '<p style="color:#8e8e93;">No active offers configured.</p>';
        return;
      }
      content.innerHTML = offers
        .map(
          (o) => `
        <div style="background:#252830;padding:14px;border-radius:14px;margin-bottom:12px;">
          <h4 style="color:#fff;margin-bottom:4px;">${escapeHtml(o.title)}</h4>
          <p style="font-size:0.82rem;color:#8e8e93;">${escapeHtml(o.description)}</p>
          <ul style="font-size:0.75rem;color:#34C759;margin:8px 0 0 16px;">
            ${(o.terms || []).map((t) => `<li>${escapeHtml(t)}</li>`).join('')}
          </ul>
        </div>
      `
        )
        .join('');
    } catch (err) {
      content.innerHTML = '<p style="color:#FF453A;">Failed to load offers from database.</p>';
    }
  }

  function openInfoModal(title, htmlBody) {
    document.getElementById('infoModalTitle').innerText = title;
    document.getElementById('infoModalBody').innerHTML = htmlBody;
    document.getElementById('infoModal').classList.remove('hidden');
  }

  function showToast(msg) {
    const t = document.getElementById('toast');
    t.innerText = msg;
    t.classList.remove('hidden');
    setTimeout(() => t.classList.add('hidden'), 2800);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
