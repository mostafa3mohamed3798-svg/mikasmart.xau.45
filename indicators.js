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
