import React, { useState, useEffect } from 'react';
import { ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Activity, TrendingUp, TrendingDown, Minus } from 'lucide-react';

const GLD_TICKER = 'GLD';

const formatVal = (val) => {
  if (val === undefined || val === null || isNaN(val)) return '0.00';
  return Number(val).toFixed(2);
};

// Improved Candlestick with better pixel estimation
const CandlestickDot = ({ cx, cy, payload, index, dataSet }) => {
  if (!payload || cx === undefined || cy === undefined) return null;
  if (!payload.open || !payload.close || !payload.high || !payload.low) return null;

  const { open, close, high, low, prevClose } = payload;
  // Green if close is higher than previous day's close, red otherwise
  const isUp = prevClose != null ? (close >= prevClose) : (close >= open);
  const color = isUp ? '#00ff88' : '#ff4d4d';

  // Better pixel estimation using global price range
  // Chart height is approximately 380px (450 - margins)
  // We need to calculate pixels per dollar based on visible range
  const chartHeight = 380;
  const visiblePriceRange = dataSet.priceRange || 100; // fallback
  const pixelsPerDollar = chartHeight / visiblePriceRange;

  // Calculate Y positions relative to close price (which is at cy)
  const yHigh = cy - (high - close) * pixelsPerDollar;
  const yLow = cy + (close - low) * pixelsPerDollar;
  const yOpen = cy + (close - open) * pixelsPerDollar;

  const bodyTop = Math.min(cy, yOpen);
  const bodyHeight = Math.max(2, Math.abs(cy - yOpen));
  const barWidth = 10;

  return (
    <g key={`candle-${index}`}>
      <line x1={cx} y1={yHigh} x2={cx} y2={yLow} stroke={color} strokeWidth={1.5} />
      <rect x={cx - barWidth / 2} y={bodyTop} width={barWidth} height={bodyHeight} fill={color} stroke={color} />
    </g>
  );
};

const CustomTooltip = ({ active, payload }) => {
  if (active && payload && payload.length > 0) {
    const d = payload[0].payload;
    return (
      <div style={{ background: 'rgba(10,10,12,0.95)', border: '1px solid rgba(255,255,255,0.2)', padding: '1rem', borderRadius: '10px', boxShadow: '0 10px 30px rgba(0,0,0,0.8)' }}>
        <p style={{ color: '#d4af37', fontWeight: 'bold', marginBottom: '0.5rem', fontSize: '0.85rem' }}>{d.date}</p>
        <div style={{ fontSize: '0.75rem', lineHeight: '1.6' }}>
          <p style={{ color: '#fff' }}>O: ${formatVal(d.open)} | C: ${formatVal(d.close)}</p>
          <p style={{ color: '#00ff88' }}>H: ${formatVal(d.high)} | <span style={{ color: '#ff4d4d' }}>L: ${formatVal(d.low)}</span></p>
          <hr style={{ margin: '0.5rem 0', border: 'none', borderTop: '1px solid rgba(255,255,255,0.1)' }} />
          <p style={{ color: '#40E0D0' }}>Tenkan: ${formatVal(d.tenkan)}</p>
          <p style={{ color: '#DC143C' }}>Kijun: ${formatVal(d.kijun)}</p>
        </div>
      </div>
    );
  }
  return null;
};

function App() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentPrice, setCurrentPrice] = useState(0);
  const [ichimoku, setIchimoku] = useState(null);
  const [priceRange, setPriceRange] = useState({ min: 0, max: 0, range: 100 });

  useEffect(() => {
    fetchRealData();
    const interval = setInterval(fetchRealData, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const fetchRealData = async () => {
    try {
      const response = await fetch('https://raw.githubusercontent.com/nikkamalf/tradingpulse/main/website/public/data.json?t=' + Date.now());
      if (!response.ok) throw new Error('Data unavailable');

      const textData = await response.text();
      const jsonData = JSON.parse(textData);

      const history = (jsonData.history || []).map((day, idx) => {
        const signal = (jsonData.signalHistory || []).find(s => s.date?.split('T')[0] === day.date?.split('T')[0]);
        const prevClose = idx > 0 ? jsonData.history[idx - 1].close : null;
        return {
          date: day.date?.split('T')[0] || day.date,
          open: day.open,
          close: day.close,
          high: day.high,
          low: day.low,
          prevClose: prevClose,
          tenkan: day.tenkan,
          kijun: day.kijun,
          spanA: day.spanA,
          spanB: day.spanB,
          cloudMin: Math.min(day.spanA || 0, day.spanB || 0),
          cloudMax: Math.max(day.spanA || 0, day.spanB || 0),
          signalType: signal ? (signal.type || signal.signal) : null
        };
      });

      // Calculate actual price range for the dataset
      let min = Infinity;
      let max = -Infinity;
      history.forEach(d => {
        const values = [d.low, d.high, d.tenkan, d.kijun, d.spanA, d.spanB].filter(v => v != null);
        values.forEach(v => {
          if (v < min) min = v;
          if (v > max) max = v;
        });
      });
      const range = max - min;
      setPriceRange({ min, max, range });

      setData(history);
      setCurrentPrice(jsonData.price || 0);
      setIchimoku({
        signal: jsonData.signal || 'NEUTRAL',
        tenkan: jsonData.ichimoku?.tenkan || 0,
        kijun: jsonData.ichimoku?.kijun || 0,
        spanA: jsonData.ichimoku?.senkouA || 0,
        spanB: jsonData.ichimoku?.senkouB || 0
      });
      setLoading(false);
    } catch (err) {
      console.error('Data fetch error:', err.message);
      setData([]);
      setIchimoku({ signal: 'NEUTRAL', tenkan: 0, kijun: 0, spanA: 0, spanB: 0 });
      setLoading(false);
    }
  };

  if (loading) return (
    <div style={{ background: '#0a0a0c', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: '#d4af37', fontSize: '1rem', letterSpacing: '3px' }}>LOADING MARKET DATA...</p>
    </div>
  );

  if (!ichimoku) return null;

  return (
    <div className="container fade-in">
      <header className="header">
        <div className="logo"><Activity size={18} /> TradingPulse</div>
        <div className="system-status">
          <span style={{ color: '#00ff88', fontSize: '0.7rem', fontWeight: '900' }}>● LIVE</span>
        </div>
      </header>

      <div className="price-card">
        <p className="price-label">{GLD_TICKER} Spot Price</p>
        <div className="price-value"><span className="price-symbol">$</span>{formatVal(currentPrice)}</div>
        <div className={`signal-badge signal-${(ichimoku.signal || 'neutral').toLowerCase()}`}>
          {ichimoku.signal === 'BUY' ? <TrendingUp size={12} /> : (ichimoku.signal === 'SELL' ? <TrendingDown size={12} /> : <Minus size={12} />)}
          &nbsp;{ichimoku.signal || 'NEUTRAL'}
        </div>
      </div>

      <div className="grid">
        <div className="stat-card"><p className="stat-label">Tenkan</p><p className="stat-value">${formatVal(ichimoku.tenkan)}</p></div>
        <div className="stat-card"><p className="stat-label">Kijun</p><p className="stat-value">${formatVal(ichimoku.kijun)}</p></div>
        <div className="stat-card"><p className="stat-label">Cloud A</p><p className="stat-value">${formatVal(ichimoku.spanA)}</p></div>
        <div className="stat-card"><p className="stat-label">Cloud B</p><p className="stat-value">${formatVal(ichimoku.spanB)}</p></div>
      </div>

      {data.length > 0 && (
        <div className="chart-container" style={{ padding: '2rem 1rem' }}>
          <h3 style={{ marginBottom: '1.5rem', marginLeft: '2rem', fontSize: '0.85rem', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '2px' }}>Technical Chart Analysis</h3>
          <ResponsiveContainer width="100%" height={450}>
            <ComposedChart data={data} margin={{ top: 20, right: 30, left: 10, bottom: 20 }}>
              <defs>
                <linearGradient id="cloudFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#00ff88" stopOpacity={0.15} />
                  <stop offset="100%" stopColor="#00ff88" stopOpacity={0.05} />
                </linearGradient>
              </defs>

              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="date" stroke="rgba(255,255,255,0.3)" fontSize={9} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={50} />
              <YAxis stroke="rgba(255,255,255,0.3)" fontSize={10} axisLine={false} tickLine={false} domain={['auto', 'auto']} tickFormatter={v => `$${Math.round(v)}`} />
              <Tooltip content={<CustomTooltip />} />

              {/* Cloud fill */}
              <Line type="monotone" dataKey="cloudMax" stroke="transparent" fill="url(#cloudFill)" isAnimationActive={false} dot={false} />
              <Line type="monotone" dataKey="cloudMin" stroke="transparent" fill="url(#cloudFill)" fillOpacity={0} isAnimationActive={false} dot={false} />

              {/* Ichimoku lines */}
              <Line type="monotone" dataKey="tenkan" stroke="#40E0D0" strokeWidth={1.5} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="kijun" stroke="#DC143C" strokeWidth={1.5} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="spanA" stroke="#2E8B57" strokeWidth={1} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="spanB" stroke="#8B4513" strokeWidth={1} dot={false} isAnimationActive={false} />

              {/* Candlesticks with improved calculation */}
              <Line
                type="monotone"
                dataKey="close"
                stroke="transparent"
                strokeWidth={0}
                dot={(props) => <CandlestickDot {...props} dataSet={priceRange} />}
                isAnimationActive={false}
                legendType="none"
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      <footer style={{ marginTop: '2rem', textAlign: 'center', opacity: 0.25, fontSize: '0.65rem' }}>
        <p>INSTITUTIONAL SIGNAL TRACKER • UPDATES HOURLY</p>
        <p style={{ marginTop: '0.5rem', maxWidth: '300px', margin: '0.5rem auto 0', lineHeight: '1.4' }}>
          Disclaimer: This tool is for informational purposes only and does not constitute financial advice. Market data is updated roughly every 30 minutes.
        </p>
      </footer>
    </div>
  );
}

export default App; // trigger redeploy
