// =========================================================================
// Gold Futures (XAUUSDT) Tracker — النسخة المُصححة
// التعديلات الأساسية:
// 1) سعر حقيقي لعقد الذهب المستقبلي XAUUSDT من Binance Futures API مباشرة
//    (رسمي، مجاني، بدون مفتاح، يدعم CORS من المتصفح - بدون أي proxy وسيط)
// 2) شموع تاريخية حقيقية (من Binance klines) بدل التوليد العشوائي
// 3) إغلاق الشمعة الحالية فعليًا وفتح شمعة جديدة عند بداية فريم زمني جديد
// 4) إصلاح استخدام event الضمني في changeTimeframe
// 5) تردد طلبات معقول (كل 3 ثواني) لاحترام حدود Binance للطلبات
// =========================================================================

const priceElement = document.getElementById('price');
const signalTagElement = document.getElementById('signalTag');
const signalPowerElement = document.getElementById('signalPower');

const slValElement = document.getElementById('slVal');
const tp1ValElement = document.getElementById('tp1Val');
const tp2ValElement = document.getElementById('tp2Val');
const executeBtn = document.getElementById('executeBtn');

const vwapFilterVal = document.getElementById('vwapFilterVal');
const macdFilterVal = document.getElementById('macdFilterVal');

const bullishPercentText = document.getElementById('bullishPercentText');
const bearishPercentText = document.getElementById('bearishPercentText');
const bullishBar = document.getElementById('bullishBar');
const bearishBar = document.getElementById('bearishBar');
const candleTimer = document.getElementById('candleTimer');

let lastLivePrice = 0;
let currentTimeframe = '1m';
let showEMAs = true;
let showVWAP = true;
let currentTradeSetup = null;

let globalCandles = [];
let globalVolumes = [];

let lockedSignalType = null;
let lockedCandleTime = null;

let isFetchingPrice = false;
let isLoadingHistory = false;

// -------------------------------------------------------------------------
// إعدادات الفريم الزمني: كل فريم له مدة بالثواني + كوود الإنترفال في Binance
// -------------------------------------------------------------------------
const TF_CONFIG = {
    '1m':  { seconds: 60,  binanceInterval: '1m'  },
    '5m':  { seconds: 300, binanceInterval: '5m'  },
    '15m': { seconds: 900, binanceInterval: '15m' },
};

// Binance Futures - XAUUSDT (عقد الذهب المستقبلي بالدولار على Binance)
const GOLD_SYMBOL = 'XAUUSDT';
const BINANCE_FAPI = 'https://fapi.binance.com/fapi/v1';

function getTfSeconds() {
    return TF_CONFIG[currentTimeframe].seconds;
}

// Binance Futures API عام ومفتوح CORS - بدون أي proxy وسيط
function buildBinanceKlinesUrl(interval, limit) {
    return `${BINANCE_FAPI}/klines?symbol=${GOLD_SYMBOL}&interval=${interval}&limit=${limit}`;
}

function buildBinancePriceUrl() {
    return `${BINANCE_FAPI}/ticker/price?symbol=${GOLD_SYMBOL}`;
}

const chart = LightweightCharts.createChart(document.getElementById('chart'), {
    layout: { backgroundColor: '#020408', textColor: '#94a3b8' },
    grid: { vertLines: { color: 'rgba(30, 41, 59, 0.2)' }, horzLines: { color: 'rgba(30, 41, 59, 0.2)' } },
    timeScale: { timeVisible: true, secondsVisible: false },
});

const candlestickSeries = chart.addCandlestickSeries({
    upColor: '#22c55e', downColor: '#ef4444', borderVisible: true,
    borderUpColor: '#22c55e', borderDownColor: '#ef4444', wickUpColor: '#22c55e', wickDownColor: '#ef4444'
});

const ema50Series = chart.addLineSeries({ color: '#3b82f6', lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
const ema200Series = chart.addLineSeries({ color: '#ec4899', lineWidth: 2.5, priceLineVisible: false, lastValueVisible: false });
const vwapSeries = chart.addLineSeries({ color: '#a855f7', lineWidth: 2, priceLineVisible: false, lastValueVisible: false });

function calculateEMA(candles, period) {
    if (candles.length < period) return [];
    let emaData = [];
    const k = 2 / (period + 1);
    let sum = 0;
    for (let i = 0; i < period; i++) sum += candles[i].close;
    let prevEMA = sum / period;
    emaData.push({ time: candles[period - 1].time, value: prevEMA });

    for (let i = period; i < candles.length; i++) {
        const close = candles[i].close;
        prevEMA = (close * k) + (prevEMA * (1 - k));
        emaData.push({ time: candles[i].time, value: prevEMA });
    }
    return emaData;
}

function calculateVWAP(candles, volumes) {
    if (candles.length === 0 || volumes.length === 0) return [];
    let vwapData = [];
    let cumulativeTPV = 0;
    let cumulativeVolume = 0;

    for (let i = 0; i < candles.length; i++) {
        const typicalPrice = (candles[i].high + candles[i].low + candles[i].close) / 3;
        const vol = volumes[i] ? volumes[i].value : 0;
        cumulativeTPV += typicalPrice * vol;
        cumulativeVolume += vol;

        const vwapVal = cumulativeVolume > 0 ? cumulativeTPV / cumulativeVolume : typicalPrice;
        vwapData.push({ time: candles[i].time, value: vwapVal });
    }
    return vwapData;
}

// -------------------------------------------------------------------------
// تحليل الشمعة الحالية + التعامل مع فتح شمعة جديدة عند بداية فريم جديد
// -------------------------------------------------------------------------
function updateCurrentCandle(activePrice) {
    const tfSeconds = getTfSeconds();
    const now = Math.floor(Date.now() / 1000);
    const periodStart = Math.floor(now / tfSeconds) * tfSeconds;

    let currentCandle = globalCandles[globalCandles.length - 1];

    if (!currentCandle || currentCandle.time !== periodStart) {
        // فريم زمني جديد بدأ -> اقفل الشمعة القديمة وافتح شمعة جديدة حقيقية
        currentCandle = {
            time: periodStart,
            open: activePrice,
            high: activePrice,
            low: activePrice,
            close: activePrice,
        };
        globalCandles.push(currentCandle);
        globalVolumes.push({ time: periodStart, value: 0 });

        // حافظ على حجم معقول للتاريخ المعروض
        if (globalCandles.length > 500) {
            globalCandles.shift();
            globalVolumes.shift();
        }

        // شمعة جديدة = لازم نعيد فتح قفل الإشارة
        lockedSignalType = null;
    } else {
        if (activePrice > currentCandle.high) currentCandle.high = activePrice;
        if (activePrice < currentCandle.low) currentCandle.low = activePrice;
        currentCandle.close = activePrice;
    }

    return currentCandle;
}

function analyzeCurrentCandle(activePrice) {
    const currentCandle = updateCurrentCandle(activePrice);

    const high = currentCandle.high;
    const low = currentCandle.low;
    const totalRange = high - low;

    let bullPct = 50;
    let bearPct = 50;

    if (totalRange > 0) {
        const distanceFromLow = activePrice - low;
        bullPct = (distanceFromLow / totalRange) * 100;
        bullPct = Math.max(0, Math.min(100, bullPct));
        bearPct = 100 - bullPct;
    }

    bullishPercentText.innerText = `صعود: ${bullPct.toFixed(1)}%`;
    bearishPercentText.innerText = `هبوط: ${bearPct.toFixed(1)}%`;
    bullishBar.style.width = `${bullPct}%`;
    bearishBar.style.width = `${bearPct}%`;

    const tfSeconds = getTfSeconds();
    const now = Math.floor(Date.now() / 1000);
    const elapsedSeconds = now - currentCandle.time;
    const remainingSeconds = Math.max(0, tfSeconds - elapsedSeconds);

    const remMin = Math.floor(remainingSeconds / 60);
    const remSec = remainingSeconds % 60;
    candleTimer.innerText = `إغلاق: ${remMin}:${remSec < 10 ? '0' : ''}${remSec}`;

    return { bullPct, bearPct, candleTime: currentCandle.time };
}

function analyzeMarket() {
    if (globalCandles.length < 50 || lastLivePrice === 0) return;

    const activePrice = lastLivePrice;
    const candleInfo = analyzeCurrentCandle(activePrice);

    const ema50Data = calculateEMA(globalCandles, 50);
    const ema200Data = calculateEMA(globalCandles, 200);
    const vwapData = calculateVWAP(globalCandles, globalVolumes);
    const currentVwap = vwapData.length > 0 ? vwapData[vwapData.length - 1].value : activePrice;

    if (lockedCandleTime !== candleInfo.candleTime) {
        lockedSignalType = null;
        lockedCandleTime = candleInfo.candleTime;
    }

    let signalType = lockedSignalType;

    if (!signalType) {
        if (candleInfo.bullPct >= 53) {
            signalType = 'BUY';
            lockedSignalType = 'BUY';
        } else if (candleInfo.bearPct >= 53) {
            signalType = 'SELL';
            lockedSignalType = 'SELL';
        }
    }

    const currentCandleRange = globalCandles[globalCandles.length - 1].high - globalCandles[globalCandles.length - 1].low;
    const dynamicTP = Math.max(2.5, currentCandleRange * 0.45);
    const dynamicSL = Math.max(2.0, currentCandleRange * 0.5);

    if (signalType === 'BUY') {
        const slPrice = activePrice - dynamicSL;
        const tp1Price = activePrice + dynamicTP;
        const tp2Price = activePrice + (dynamicTP * 1.8);

        currentTradeSetup = { type: 'BUY (XAUUSD Futures)', entry: activePrice.toFixed(2), sl: slPrice.toFixed(2), tp1: tp1Price.toFixed(2), tp2: tp2Price.toFixed(2) };

        signalTagElement.innerHTML = `🟢 شراء ذهب (GC Futures Buy)`;
        signalTagElement.className = `signal-tag signal-strong`;
        signalPowerElement.innerHTML = `<span dir="ltr">زخم صاعد قوي</span>`;

        slValElement.innerHTML = `<span dir="ltr">$${currentTradeSetup.sl}</span>`;
        tp1ValElement.innerHTML = `<span dir="ltr">$${currentTradeSetup.tp1}</span>`;
        tp2ValElement.innerHTML = `<span dir="ltr">$${currentTradeSetup.tp2}</span>`;

        executeBtn.className = `execute-btn strong-buy-active`;
        executeBtn.innerHTML = `🚀 تنفيذ شراء (هدف $${dynamicTP.toFixed(1)}) - سعر <span dir="ltr">${activePrice.toFixed(2)}</span>`;
    } else if (signalType === 'SELL') {
        const slPrice = activePrice + dynamicSL;
        const tp1Price = activePrice - dynamicTP;
        const tp2Price = activePrice - (dynamicTP * 1.8);

        currentTradeSetup = { type: 'SELL (XAUUSD Futures)', entry: activePrice.toFixed(2), sl: slPrice.toFixed(2), tp1: tp1Price.toFixed(2), tp2: tp2Price.toFixed(2) };

        signalTagElement.innerHTML = `🔴 بيع ذهب (GC Futures Sell)`;
        signalTagElement.className = `signal-tag signal-strong-sell`;
        signalPowerElement.innerHTML = `<span dir="ltr">زخم هابط قوي</span>`;

        slValElement.innerHTML = `<span dir="ltr">$${currentTradeSetup.sl}</span>`;
        tp1ValElement.innerHTML = `<span dir="ltr">$${currentTradeSetup.tp1}</span>`;
        tp2ValElement.innerHTML = `<span dir="ltr">$${currentTradeSetup.tp2}</span>`;

        executeBtn.className = `execute-btn strong-sell-active`;
        executeBtn.innerHTML = `💥 تنفيذ بيع (هدف $${dynamicTP.toFixed(1)}) - سعر <span dir="ltr">${activePrice.toFixed(2)}</span>`;
    } else {
        currentTradeSetup = null;
        signalTagElement.innerHTML = `⏳ بانتظار استقرار الزخم...`;
        signalTagElement.className = `signal-tag signal-wait`;
        signalPowerElement.innerHTML = `<span dir="ltr">ترقب لحظي</span>`;

        slValElement.innerHTML = `---`;
        tp1ValElement.innerHTML = `---`;
        tp2ValElement.innerHTML = `---`;

        executeBtn.className = `execute-btn wait-active`;
        executeBtn.innerHTML = `⏳ بانتظار استقرار الزخم`;
    }

    vwapFilterVal.innerHTML = `<span dir="ltr">${activePrice >= currentVwap ? 'فوق VWAP' : 'تحت VWAP'}</span>`;
    macdFilterVal.innerHTML = `<span dir="ltr">نبض فوري</span>`;

    candlestickSeries.update(globalCandles[globalCandles.length - 1]);

    if (showEMAs && ema50Data.length > 0) {
        ema50Series.setData(ema50Data);
        ema200Series.setData(ema200Data);
    } else {
        ema50Series.setData([]);
        ema200Series.setData([]);
    }

    if (showVWAP && vwapData.length > 0) {
        vwapSeries.setData(vwapData);
    } else {
        vwapSeries.setData([]);
    }
}

function executeOrder() {
    if (!currentTradeSetup) {
        alert('⚠️ انتظر إشارة واضحة للتنفيذ.');
        return;
    }
    alert(`✅ تنفيذ صفقة الذهب:\nالنوع: ${currentTradeSetup.type}\nالدخول: $${currentTradeSetup.entry}\nالهدف الأول: $${currentTradeSetup.tp1}\nالهدف الثاني: $${currentTradeSetup.tp2}\nوقف الخسارة: $${currentTradeSetup.sl}`);
}

// -------------------------------------------------------------------------
// تحميل شموع حقيقية من Binance Futures (XAUUSDT) بدل التوليد العشوائي
// -------------------------------------------------------------------------
async function loadChartData() {
    if (isLoadingHistory) return;
    isLoadingHistory = true;

    try {
        const cfg = TF_CONFIG[currentTimeframe];
        const url = buildBinanceKlinesUrl(cfg.binanceInterval, 500);

        const res = await fetch(url);
        const raw = await res.json();

        if (!Array.isArray(raw) || raw.length === 0) {
            console.error('لا توجد بيانات شموع من Binance لهذا الرمز/الفريم.');
            return;
        }

        // شكل كل شمعة من Binance:
        // [openTime, open, high, low, close, volume, closeTime, ...]
        let tempCandles = [];
        let tempVolumes = [];

        for (const k of raw) {
            const timeSec = Math.floor(k[0] / 1000);
            const open = parseFloat(k[1]);
            const high = parseFloat(k[2]);
            const low = parseFloat(k[3]);
            const close = parseFloat(k[4]);
            const volume = parseFloat(k[5]);

            tempCandles.push({ time: timeSec, open, high, low, close });
            tempVolumes.push({ time: timeSec, value: volume || 0 });
        }

        globalCandles = tempCandles;
        globalVolumes = tempVolumes;

        // احتياطي: لو السعر اللحظي لسه ما جاله رد، استخدم إقفال آخر شمعة
        if (lastLivePrice === 0) {
            const lastClose = globalCandles[globalCandles.length - 1].close;
            lastLivePrice = lastClose;
            priceElement.innerText = `$${lastClose.toFixed(2)}`;
        }

        lockedSignalType = null;
        lockedCandleTime = null;

        candlestickSeries.setData(globalCandles);
        analyzeMarket();

        chart.timeScale().setVisibleLogicalRange({
            from: Math.max(0, globalCandles.length - 30),
            to: globalCandles.length - 1
        });
    } catch (err) {
        console.error('خطأ في تحميل الشموع التاريخية:', err);
    } finally {
        isLoadingHistory = false;
    }
}

// -------------------------------------------------------------------------
// سعر لحظي لعقد الذهب المستقبلي XAUUSDT من Binance Futures مباشرة
// -------------------------------------------------------------------------
async function fetchLiveGoldPrice() {
    if (isFetchingPrice) return;
    isFetchingPrice = true;

    try {
        const url = buildBinancePriceUrl();
        const res = await fetch(url);
        const json = await res.json();

        const rawPrice = parseFloat(json?.price);

        if (rawPrice) {
            if (lastLivePrice > 0) {
                priceElement.style.color = rawPrice > lastLivePrice ? '#22c55e' : (rawPrice < lastLivePrice ? '#ef4444' : '#3b82f6');
            }
            lastLivePrice = rawPrice;
            priceElement.innerText = `$${rawPrice.toFixed(2)}`;

            if (globalCandles.length === 0) {
                await loadChartData();
            } else {
                analyzeMarket();
            }
        }
    } catch (err) {
        console.error('خطأ في جلب سعر الفيوتشر اللحظي:', err);
    } finally {
        isFetchingPrice = false;
    }
}

// -------------------------------------------------------------------------
// أدوات التحكم بالواجهة
// -------------------------------------------------------------------------
function changeTimeframe(tf, evt) {
    currentTimeframe = tf;
    lockedSignalType = null;

    document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));

    // دعم استدعاء بدون تمرير event صريح (توافق مع onclick القديم)
    const e = evt || window.event;
    if (e && e.target) e.target.classList.add('active');

    loadChartData();
}

function toggleEMA() {
    showEMAs = !showEMAs;
    document.getElementById('emaToggle').classList.toggle('active', showEMAs);
    if (globalCandles.length > 0) analyzeMarket();
}

function toggleVWAP() {
    showVWAP = !showVWAP;
    document.getElementById('vwapToggle').classList.toggle('active', showVWAP);
    if (globalCandles.length > 0) analyzeMarket();
}

// -------------------------------------------------------------------------
// التشغيل: تحميل تاريخي أولي مرة واحدة، وسعر لحظي كل 3 ثواني
// (Binance بيسمح بمعدل طلبات عالي، لكن كل 3 ثواني كافي جدًا للعرض اللحظي)
// -------------------------------------------------------------------------
loadChartData();
fetchLiveGoldPrice();
setInterval(fetchLiveGoldPrice, 3000);
