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

// إضافة فريم الـ 4 ساعات (4h) هنا
const TF_CONFIG = {
    '1m':  { seconds: 60,    bybitInterval: '1'   },
    '5m':  { seconds: 300,   bybitInterval: '5'   },
    '15m': { seconds: 900,   bybitInterval: '15'  },
    '4h':  { seconds: 14400, bybitInterval: '240' }
};

const GOLD_SPOT_URL = 'https://api.bybit.com/v5/market/tickers?category=linear&symbol=XAUUSDT';
const GOLD_KLINES_URL = 'https://api.bybit.com/v5/market/kline';

function getTfSeconds() {
    return TF_CONFIG[currentTimeframe].seconds;
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
    if (!candles || candles.length === 0) return [];
    let emaData = [];
    const k = 2 / (period + 1);
    let sum = 0;
    
    const actualPeriod = Math.min(candles.length, period);
    for (let i = 0; i < actualPeriod; i++) sum += candles[i].close;
    let prevEMA = sum / actualPeriod;
    
    emaData.push({ time: candles[actualPeriod - 1].time, value: prevEMA });

    for (let i = actualPeriod; i < candles.length; i++) {
        const close = candles[i].close;
        prevEMA = (close * k) + (prevEMA * (1 - k));
        emaData.push({ time: candles[i].time, value: prevEMA });
    }
    return emaData;
}

function calculateVWAP(candles, volumes) {
    if (!candles || candles.length === 0 || !volumes || volumes.length === 0) return [];
    let vwapData = [];
    let cumulativeTPV = 0;
    let cumulativeVolume = 0;

    for (let i = 0; i < candles.length; i++) {
        const typicalPrice = (candles[i].high + candles[i].low + candles[i].close) / 3;
        const vol = volumes[i] && volumes[i].value ? volumes[i].value : 1;
        cumulativeTPV += typicalPrice * vol;
        cumulativeVolume += vol;

        const vwapVal = cumulativeVolume > 0 ? cumulativeTPV / cumulativeVolume : typicalPrice;
        vwapData.push({ time: candles[i].time, value: vwapVal });
    }
    return vwapData;
}

function updateCurrentCandle(activePrice) {
    const tfSeconds = getTfSeconds();
    const now = Math.floor(Date.now() / 1000);
    const periodStart = Math.floor(now / tfSeconds) * tfSeconds;

    let currentCandle = globalCandles[globalCandles.length - 1];
    let currentVol = globalVolumes[globalVolumes.length - 1];

    if (!currentCandle || currentCandle.time !== periodStart) {
        currentCandle = {
            time: periodStart,
            open: activePrice,
            high: activePrice,
            low: activePrice,
            close: activePrice,
        };
        globalCandles.push(currentCandle);
        globalVolumes.push({ time: periodStart, value: 1 });

        if (globalCandles.length > 300) {
            globalCandles.shift();
            globalVolumes.shift();
        }

        lockedSignalType = null;
    } else {
        if (activePrice > currentCandle.high) currentCandle.high = activePrice;
        if (activePrice < currentCandle.low) currentCandle.low = activePrice;
        currentCandle.close = activePrice;
        
        if (currentVol) {
            currentVol.value += 1;
        }
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

    const remHours = Math.floor(remainingSeconds / 3600);
    const remMin = Math.floor((remainingSeconds % 3600) / 60);
    const remSec = remainingSeconds % 60;
    
    // عرض الوقت بشكل يدعم الساعات لو فريم 4 ساعات نشط
    if (currentTimeframe === '4h') {
        candleTimer.innerText = `إغلاق: ${remHours}س ${remMin}د`;
    } else {
        candleTimer.innerText = `إغلاق: ${remMin}:${remSec < 10 ? '0' : ''}${remSec}`;
    }

    return { bullPct, bearPct, candleTime: currentCandle.time };
}

function analyzeMarket() {
    if (globalCandles.length === 0 || lastLivePrice === 0) return;

    const activePrice = lastLivePrice;
    const candleInfo = analyzeCurrentCandle(activePrice);

    const ema50Data = calculateEMA(globalCandles, 50);
    const ema200Data = calculateEMA(globalCandles, 200);
    const vwapData = calculateVWAP(globalCandles, globalVolumes);
    const currentVwap = vwapData.length > 0 ? vwapData[vwapData.length - 1].value : activePrice;
    
    // استخراج قيمة EMA 200 الأخيرة لتحديد اتجاه الترند العام
    const currentEma200 = ema200Data.length > 0 ? ema200Data[ema200Data.length - 1].value : activePrice;

    if (lockedCandleTime !== candleInfo.candleTime) {
        lockedSignalType = null;
        lockedCandleTime = candleInfo.candleTime;
    }

    let signalType = lockedSignalType;

    if (!signalType) {
        // فلتر الترند: تفعيل الشراء فقط إذا السعر فوق EMA 200، والبيع فقط إذا تحت EMA 200
        if (candleInfo.bullPct >= 53 && activePrice >= currentEma200) {
            signalType = 'BUY';
            lockedSignalType = 'BUY';
        } else if (candleInfo.bearPct >= 53 && activePrice <= currentEma200) {
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

        currentTradeSetup = { type: 'BUY (Bybit XAUUSDT)', entry: activePrice.toFixed(2), sl: slPrice.toFixed(2), tp1: tp1Price.toFixed(2), tp2: tp2Price.toFixed(2) };

        signalTagElement.innerHTML = `🟢 شراء ذهب (Bybit Buy)`;
        signalTagElement.className = `signal-tag signal-strong`;
        signalPowerElement.innerHTML = `<span dir="ltr">زخم صاعد + ترند إيجابي</span>`;

        slValElement.innerHTML = `<span dir="ltr">$${currentTradeSetup.sl}</span>`;
        tp1ValElement.innerHTML = `<span dir="ltr">$${currentTradeSetup.tp1}</span>`;
        tp2ValElement.innerHTML = `<span dir="ltr">$${currentTradeSetup.tp2}</span>`;

        executeBtn.className = `execute-btn strong-buy-active`;
        executeBtn.innerHTML = `🚀 تنفيذ شراء (هدف $${dynamicTP.toFixed(1)}) - سعر <span dir="ltr">${activePrice.toFixed(2)}</span>`;
    } else if (signalType === 'SELL') {
        const slPrice = activePrice + dynamicSL;
        const tp1Price = activePrice - dynamicTP;
        const tp2Price = activePrice - (dynamicTP * 1.8);

        currentTradeSetup = { type: 'SELL (Bybit XAUUSDT)', entry: activePrice.toFixed(2), sl: slPrice.toFixed(2), tp1: tp1Price.toFixed(2), tp2: tp2Price.toFixed(2) };

        signalTagElement.innerHTML = `🔴 بيع ذهب (Bybit Sell)`;
        signalTagElement.className = `signal-tag signal-strong-sell`;
        signalPowerElement.innerHTML = `<span dir="ltr">زخم هابط + ترند سلبي</span>`;

        slValElement.innerHTML = `<span dir="ltr">$${currentTradeSetup.sl}</span>`;
        tp1ValElement.innerHTML = `<span dir="ltr">$${currentTradeSetup.tp1}</span>`;
        tp2ValElement.innerHTML = `<span dir="ltr">$${currentTradeSetup.tp2}</span>`;

        executeBtn.className = `execute-btn strong-sell-active`;
        executeBtn.innerHTML = `💥 تنفيذ بيع (هدف $${dynamicTP.toFixed(1)}) - سعر <span dir="ltr">${activePrice.toFixed(2)}</span>`;
    } else {
        currentTradeSetup = null;
        signalTagElement.innerHTML = `⏳ بانتظار استقرار الزخم والترند...`;
        signalTagElement.className = `signal-tag signal-wait`;
        signalPowerElement.innerHTML = `<span dir="ltr">ترقب لحظي</span>`;

        slValElement.innerHTML = `---`;
        tp1ValElement.innerHTML = `---`;
        tp2ValElement.innerHTML = `---`;

        executeBtn.className = `execute-btn wait-active`;
        executeBtn.innerHTML = `⏳ بانتظار توافق الزخم مع EMA 200`;
    }

    vwapFilterVal.innerHTML = `<span dir="ltr">${activePrice >= currentVwap ? 'فوق VWAP' : 'تحت VWAP'}</span>`;

    candlestickSeries.update(globalCandles[globalCandles.length - 1]);

    if (showEMAs) {
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
        alert('⚠️ انتظر إشارة واضحة متوافقة مع الترند للتنفيذ.');
        return;
    }
    alert(`✅ تنفيذ صفقة الذهب:\nالنوع: ${currentTradeSetup.type}\nالدخول: $${currentTradeSetup.entry}\nالهدف الأول: $${currentTradeSetup.tp1}\nالهدف الثاني: $${currentTradeSetup.tp2}\nوقف الخسارة: $${currentTradeSetup.sl}`);
}

async function loadChartData() {
    lockedSignalType = null;
    lockedCandleTime = null;

    try {
        const intervalVal = TF_CONFIG[currentTimeframe].bybitInterval;
        const res = await fetch(`${GOLD_KLINES_URL}?category=linear&symbol=XAUUSDT&interval=${intervalVal}&limit=200`);
        const json = await res.json();

        if (json.retCode === 0 && json.result && json.result.list) {
            const rawKlines = json.result.list.reverse();
            
            globalCandles = [];
            globalVolumes = [];

            rawKlines.forEach(item => {
                const timeSec = Math.floor(parseInt(item[0]) / 1000);
                const open = parseFloat(item[1]);
                const high = parseFloat(item[2]);
                const low = parseFloat(item[3]);
                const close = parseFloat(item[4]);
                const volume = parseFloat(item[5]);

                globalCandles.push({ time: timeSec, open, high, low, close });
                globalVolumes.push({ time: timeSec, value: volume });
            });
        }
    } catch (err) {
        console.error('خطأ في جلب الشموع التاريخية من Bybit:', err);
    }

    candlestickSeries.setData(globalCandles);
    if (globalCandles.length > 0) {
        analyzeMarket();
        chart.timeScale().fitContent();
    }
}

async function fetchLiveGoldPrice() {
    if (isFetchingPrice) return;
    isFetchingPrice = true;

    try {
        const res = await fetch(GOLD_SPOT_URL);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const json = await res.json();
        const rawPrice = parseFloat(json?.result?.list?.[0]?.lastPrice);

        if (!rawPrice || isNaN(rawPrice)) throw new Error('لم يتم العثور على السعر من Bybit');

        if (lastLivePrice > 0) {
            priceElement.style.color = rawPrice > lastLivePrice ? '#22c55e' : (rawPrice < lastLivePrice ? '#ef4444' : '#3b82f6');
        }
        
        lastLivePrice = rawPrice;
        priceElement.innerText = `$${rawPrice.toFixed(2)}`;

        const now = new Date();
        macdFilterVal.innerHTML = `<span dir="ltr" style="color:#22c55e">✓ Bybit: ${now.toLocaleTimeString('ar-EG')}</span>`;

        if (globalCandles.length === 0) {
            await loadChartData();
        } else {
            analyzeMarket();
        }
    } catch (err) {
        macdFilterVal.innerHTML = `<span dir="ltr" style="color:#ef4444">✗ ${err.message}</span>`;
        console.error('خطأ في جلب سعر Bybit اللحظي:', err);
    } finally {
        isFetchingPrice = false;
    }
}

async function changeTimeframe(tf, evt) {
    currentTimeframe = tf;
    lockedSignalType = null;
    globalCandles = [];
    globalVolumes = [];

    candlestickSeries.setData([]);
    ema50Series.setData([]);
    ema200Series.setData([]);
    vwapSeries.setData([]);

    document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
    const e = evt || window.event;
    if (e && e.target) e.target.classList.add('active');

    if (lastLivePrice > 0) {
        await loadChartData();
    }
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

// التشغيل الأولي
fetchLiveGoldPrice();

setInterval(fetchLiveGoldPrice, 3000);

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        fetchLiveGoldPrice();
    }
});
        
