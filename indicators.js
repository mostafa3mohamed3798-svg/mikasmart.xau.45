// ==========================================
// 1. حساب مؤشر القوة النسبية (RSI)
// ==========================================
function calculateRSI(closes, period = 14) {
    if (!closes || closes.length < period + 1) return 50;
    let gains = 0, losses = 0;
    
    for (let i = 1; i <= period; i++) {
        let diff = closes[i] - closes[i - 1];
        if (diff >= 0) gains += diff;
        else losses -= diff;
    }
    
    let avgGain = gains / period;
    let avgLoss = losses / period;
    
    for (let i = period + 1; i < closes.length; i++) {
        let diff = closes[i] - closes[i - 1];
        if (diff >= 0) {
            avgGain = (avgGain * (period - 1) + diff) / period;
            avgLoss = (avgLoss * (period - 1)) / period;
        } else {
            avgGain = (avgGain * (period - 1)) / period;
            avgLoss = (avgLoss * (period - 1) - diff) / period;
        }
    }
    
    let rs = avgGain / (avgLoss === 0 ? 1 : avgLoss);
    return 100 - (100 / (1 + rs));
}

// ==========================================
// 2. حساب مؤشر التقلب (ATR)
// ==========================================
function calculateATR(candles, period = 14) {
    if (!candles || candles.length < period) return 0;
    let trList = [];
    
    for (let i = 1; i < candles.length; i++) {
        let high = Number(candles[i].high);
        let low = Number(candles[i].low);
        let prevClose = Number(candles[i - 1].close);
        
        let tr = Math.max(
            high - low,
            Math.abs(high - prevClose),
            Math.abs(low - prevClose)
        );
        trList.push(tr);
    }
    
    let sumTr = trList.slice(-period).reduce((a, b) => a + b, 0);
    return sumTr / period;
}

// ==========================================
// 3. تحديد مناطق الدعم والمقاومة البسيطة (Swing High/Low)
// ==========================================
function calculateSupportResistance(candles, lookback = 20) {
    if (!candles || candles.length < lookback) return { support: 0, resistance: 0 };
    
    let recentCandles = candles.slice(-lookback);
    let highs = recentCandles.map(c => Number(c.high));
    let lows = recentCandles.map(c => Number(c.low));
    
    let resistance = Math.max(...highs);
    let support = Math.min(...lows);
    
    return { support, resistance };
}
// دالة لتحديث الواجهة بناءً على القيم الحسابية
function applyIndicatorsToUI(candles) {
    if (!candles || candles.length < 20) return;

    let closes = candles.map(c => Number(c.close));
    let rsiValue = calculateRSI(closes, 14);
    let atrValue = calculateATR(candles, 14);
    let sr = calculateSupportResistance(candles, 20);

        function applyIndicatorsToUI(data) {
    if (!data || data.length < 10) return;

    const latest = data[data.length - 1];
    document.getElementById('price').innerText = latest.close.toFixed(2);
    
    // حساب الـ EMA لفترة 9 للتحقق من الاتجاه الفني الحقيقي
    const emaData = calculateEMA(data, 9);
    const latestEMA = emaData[emaData.length - 1].value;

    // الشرط الفني: لو السعر فوق الـ EMA يبقى شراء، لو تحته يبقى بيع
    const isBullish = latest.close > latestEMA; 

    const signalTag = document.getElementById('signalTag');
    const signalPower = document.getElementById('signalPower');
    const executeBtn = document.getElementById('executeBtn');

    const slVal = document.getElementById('slVal');
    const tp1Val = document.getElementById('tp1Val');
    const tp2Val = document.getElementById('tp2Val');

    document.getElementById('vwapFilterVal').innerText = isBullish ? 'إيجابي (Bullish)' : 'سلبي (Bearish)';
    document.getElementById('macdFilterVal').innerText = 'مستقر ⚡';
    
    const pct = isBullish ? 68 : 32;
    document.getElementById('bullishPercentText').innerText = `صعود: ${pct}%`;
    document.getElementById('bearishPercentText').innerText = `هبوط: ${100 - pct}%`;
    document.getElementById('bullishBar').style.width = `${pct}%`;
    document.getElementById('bearishBar').style.width = `${100 - pct}%`;

    if (isBullish) {
        signalTag.className = "signal-tag signal-strong";
        signalTag.innerText = "🚀 إشارة شراء قوية (BUY)";
        signalPower.innerText = "صعودي فوق المتوسط";
        signalPower.style.color = "#22c55e";

        executeBtn.className = "execute-btn strong-buy-active";
        executeBtn.innerText = "🚀 تنفيذ صفقة شراء (BUY)";

        slVal.innerText = (latest.close - 3.5).toFixed(2);
        tp1Val.innerText = (latest.close + 4.0).toFixed(2);
        tp2Val.innerText = (latest.close + 8.5).toFixed(2);
    } else {
        signalTag.className = "signal-tag signal-strong-sell";
        signalTag.innerText = "🔻 إشارة بيع قوية (SELL)";
        signalPower.innerText = "هبوطي تحت المتوسط";
        signalPower.style.color = "#ef4444";

        executeBtn.className = "execute-btn strong-sell-active";
        executeBtn.innerText = "🔻 تنفيذ صفقة بيع (SELL)";

        slVal.innerText = (latest.close + 3.5).toFixed(2);
        tp1Val.innerText = (latest.close - 4.0).toFixed(2);
        tp2Val.innerText = (latest.close - 8.5).toFixed(2);
    }
}
