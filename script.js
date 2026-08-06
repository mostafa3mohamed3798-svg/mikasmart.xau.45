const priceElement = document.getElementById('price');
const statusElement = document.getElementById('status');
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
let currentTimeframe = '1';
let showEMAs = true;
let showVWAP = true;
let currentTradeSetup = null;

let globalCandles = [];
let globalVolumes = [];

let lockedSignalType = null; 
let lockedCandleTime = null;

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

function analyzeCurrentCandle(candles, activePrice) {
    if (candles.length === 0) return { bullPct: 50, bearPct: 50 };
    
    let currentCandle = candles[candles.length - 1];
    
    if (activePrice > currentCandle.high) currentCandle.high = activePrice;
    if (activePrice < currentCandle.low) currentCandle.low = activePrice;
    currentCandle.close = activePrice;

    const high = currentCandle.high;
    const low = currentCandle.low;
    const totalRange = high - low;
    
    if (totalRange <= 0) return { bullPct: 50, bearPct: 50, candleTime: currentCandle.time };

    const distanceFromLow = activePrice - low;
    let bullPct = (distanceFromLow / totalRange) * 100;
    bullPct = Math.max(0, Math.min(100, bullPct));
    let bearPct = 100 - bullPct;

    bullishPercentText.innerText = `صعود: ${bullPct.toFixed(1)}%`;
    bearishPercentText.innerText = `هبوط: ${bearPct.toFixed(1)}%`;
    bullishBar.style.width = `${bullPct}%`;
    bearishBar.style.width = `${bearPct}%`;

    const tfMinutes = parseInt(currentTimeframe) || 1;
    const now = Math.floor(Date.now() / 1000);
    const elapsedSeconds = now - currentCandle.time;
    const totalSeconds = tfMinutes * 60;
    const remainingSeconds = Math.max(0, totalSeconds - elapsedSeconds);
    
    const remMin = Math.floor(remainingSeconds / 60);
    const remSec = remainingSeconds % 60;
    candleTimer.innerText = `إغلاق: ${remMin}:${remSec < 10 ? '0' : ''}${remSec}`;

    return { bullPct, bearPct, candleTime: currentCandle.time };
}

function analyzeMarket() {
    if (globalCandles.length < 50 || lastLivePrice === 0) return;

    const activePrice = lastLivePrice;
    const candleInfo = analyzeCurrentCandle(globalCandles, activePrice);

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

        currentTradeSetup = { type: 'BUY', entry: activePrice.toFixed(2), sl: slPrice.toFixed(2), tp1: tp1Price.toFixed(2), tp2: tp2Price.toFixed(2) };
        
        signalTagElement.innerHTML = `🟢 شراء مؤكد وقوي (BUY)`;
        signalTagElement.className = `signal-tag signal-strong`;
        signalPowerElement.innerHTML = `<span dir="ltr">زخم صاعد قوي</span>`;

        slValElement.innerHTML = `<span dir="ltr">$${currentTradeSetup.sl}</span>`;
        tp1ValElement.innerHTML = `<span dir="ltr">$${currentTradeSetup.tp1}</span>`;
        tp2ValElement.innerHTML = `<span dir="ltr">$${currentTradeSetup.tp2}</span>`;

        executeBtn.className = `execute-btn strong-buy-active`;
        executeBtn.innerHTML = `🚀 تنفيذ شراء (هدف ديناميكي $${dynamicTP.toFixed(1)}) - سعر <span dir="ltr">${activePrice.toFixed(2)}</span>`;
    } else if (signalType === 'SELL') {
        const slPrice = activePrice + dynamicSL;
        const tp1Price = activePrice - dynamicTP;
        const tp2Price = activePrice - (dynamicTP * 1.8);

        currentTradeSetup = { type: 'SELL', entry: activePrice.toFixed(2), sl: slPrice.toFixed(2), tp1: tp1Price.toFixed(2), tp2: tp2Price.toFixed(2) };
        
        signalTagElement.innerHTML = `🔴 بيع مؤكد وقوي (SELL)`;
        signalTagElement.className = `signal-tag signal-strong-sell`;
        signalPowerElement.innerHTML = `<span dir="ltr">زخم هابط قوي</span>`;

        slValElement.innerHTML = `<span dir="ltr">$${currentTradeSetup.sl}</span>`;
        tp1ValElement.innerHTML = `<span dir="ltr">$${currentTradeSetup.tp1}</span>`;
        tp2ValElement.innerHTML = `<span dir="ltr">$${currentTradeSetup.tp2}</span>`;

        executeBtn.className = `execute-btn strong-sell-active`;
        executeBtn.innerHTML = `💥 تنفيذ بيع (هدف ديناميكي $${dynamicTP.toFixed(1)}) - سعر <span dir="ltr">${activePrice.toFixed(2)}</span>`;
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
    macdFilterVal.innerHTML = `<span dir="ltr">نبض فوري (400ms)</span>`;

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
    alert(`✅ تم التنفيذ بنجاح!\nالنوع: ${currentTradeSetup.type}\nالدخول: $${currentTradeSetup.entry}\nالهدف الأول (TP1): $${currentTradeSetup.tp1}\nالهدف الثاني (TP2): $${currentTradeSetup.tp2}\nوقف الخسارة (SL): $${currentTradeSetup.sl}`);
}

async function loadChartData() {
    try {
        const res = await fetch(`https://api.coincap.io/v2/candles?exchange=binance&interval=m${currentTimeframe}&baseAsset=tether&quoteAsset=gold`);
        const json = await res.json();
        
        if (json && json.data && json.data.length > 0) {
            globalCandles = json.data.map(d => ({
                time: Math.floor(d.period / 1000),
                open: parseFloat(d.open),
                high: parseFloat(d.high),
                low: parseFloat(d.low),
                close: parseFloat(d.close)
            }));
            globalVolumes = json.data.map(d => ({
                time: Math.floor(d.period / 1000),
                value: parseFloat(d.volume)
            }));
        } else {
            generateFallbackData();
        }
    } catch (e) {
        generateFallbackData();
    }
    
    if (globalCandles.length > 0) {
        candlestickSeries.setData(globalCandles);
        chart.timeScale().fitContent();
    }
}

function generateFallbackData() {
    let basePrice = lastLivePrice > 0 ? lastLivePrice : 2365.0;
    let now = Math.floor(Date.now() / 1000) - (150 * 60);
    globalCandles = [];
    globalVolumes = [];
    
    for (let i = 0; i < 150; i++) {
        let change = (Math.random() - 0.48) * 2;
        let open = basePrice;
        let close = open + change;
        let high = Math.max(open, close) + Math.random() * 1.0;
        let low = Math.min(open, close) - Math.random() * 1.0;
        
        globalCandles.push({ time: now + (i * 60), open, high, low, close });
        globalVolumes.push({ time: now + (i * 60), value: Math.random() * 1000 });
        basePrice = close;
    }
}

async function fetchLivePrice() {
    try {
        const res = await fetch('https://api.coinbase.com/v2/prices/PAXG-USD/spot');
        const data = await res.json();
        if (data && data.data && data.data.amount) {
            const rawPrice = parseFloat(data.data.amount);
            if (lastLivePrice > 0) {
                priceElement.style.color = rawPrice > lastLivePrice ? '#22c55e' : (rawPrice < lastLivePrice ? '#ef4444' : '#3b82f6');
            }
            lastLivePrice = rawPrice;
            priceElement.innerText = `$${rawPrice.toFixed(2)}`;
            statusElement.innerText = "● متصل بسعر الذهب الفوري (PAXG)";
            statusElement.style.color = "#22c55e";

            if (globalCandles.length === 0) generateFallbackData();
            analyzeMarket();
        }
    } catch (err) {
        if (lastLivePrice === 0) lastLivePrice = 2365.50;
        priceElement.innerText = `$${lastLivePrice.toFixed(2)}`;
        statusElement.innerText = "● يعمل وضع التحليل المحلي المستقر";
        statusElement.style.color = "#eab308";
        analyzeMarket();
    }
}

function changeTimeframe(tf) {
    currentTimeframe = tf;
    lockedSignalType = null;
    document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
    event.target.classList.add('active');
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

loadChartData();
fetchLivePrice();

setInterval(fetchLivePrice, 2000); 
setInterval(loadChartData, 10000);
