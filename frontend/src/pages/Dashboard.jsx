import React, { useEffect, useState, useCallback, useRef } from 'react';
import Chart from 'chart.js/auto';
import '../styles/Dashboard.css';
import { useParams, useNavigate } from 'react-router-dom';
import { fetchDashboardData as apiFetchDashboardData, fetchComparisonData as apiFetchComparisonData, searchSymbols } from '../utils/api';

const Dashboard = () => {
  const { symbol } = useParams();
  const navigate = useNavigate();
  const [dashboardData, setDashboardData] = useState(null);
  const [comparisonData, setComparisonData] = useState(null);
  const [period, setPeriod] = useState('1y');
  const [showSP500, setShowSP500] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const chartRef = useRef(null);
  const chartInstance = useRef(null);

  const fetchAllData = useCallback(async (sym, per) => {
    setError(null);
    setDashboardData(null);
    setComparisonData(null);
    try {
      const [dashData, compData] = await Promise.all([
        apiFetchDashboardData(sym),
        apiFetchComparisonData(sym, per)
      ]);
      setDashboardData(dashData);
      setComparisonData(compData);
    } catch (err) {
      setError('Failed to load dashboard data. Please try again.');
      console.error(err);
    }
  }, []);

  useEffect(() => {
    if (symbol) {
      fetchAllData(symbol, period);
    }
  }, [symbol, period, fetchAllData]);

  useEffect(() => {
    if (chartInstance.current) {
      chartInstance.current.destroy();
    }
    if (comparisonData && chartRef.current) {
      const ctx = chartRef.current.getContext('2d');
      let datasets, yLabel;

      if (showSP500) {
        // Show both stock and S&P 500 as percent change
        datasets = [
          {
            label: `${comparisonData.stock_symbol} Performance (%)`,
            data: comparisonData.stock_performance,
            borderColor: '#007bff',
            backgroundColor: 'transparent',
            borderWidth: 2,
            fill: false,
            tension: 0.1,
            pointRadius: 0,
          },
          {
            label: 'S&P 500 Performance (%)',
            data: comparisonData.sp500_performance,
            borderColor: '#ff6384',
            backgroundColor: 'transparent',
            borderWidth: 2,
            fill: false,
            tension: 0.1,
            pointRadius: 0,
          }
        ];
        yLabel = value => value + '%';
      } else {
        // Show only stock price
        const gradient = ctx.createLinearGradient(0, 0, 0, 400);
        gradient.addColorStop(0, 'rgba(0, 123, 255, 0.3)');
        gradient.addColorStop(1, 'rgba(0, 123, 255, 0.05)');
        datasets = [
          {
            label: 'Price ($)',
            data: comparisonData.stock_prices,
            borderColor: '#007bff',
            backgroundColor: gradient,
            borderWidth: 2,
            fill: true,
            tension: 0.4,
            pointRadius: 0,
            pointHoverRadius: 6,
            pointHoverBackgroundColor: '#007bff',
            pointHoverBorderColor: '#ffffff',
            pointHoverBorderWidth: 2
          }
        ];
        yLabel = value => '$' + value.toFixed(2);
      }

      chartInstance.current = new Chart(ctx, {
        type: 'line',
        data: {
          labels: comparisonData.dates,
          datasets: datasets,
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: true },
            tooltip: {
              mode: 'index',
              intersect: false,
              backgroundColor: 'rgba(0, 0, 0, 0.8)',
              titleColor: '#ffffff',
              bodyColor: '#ffffff',
              borderColor: '#007bff',
              borderWidth: 1,
              callbacks: {
                label: function(context) {
                  if (!showSP500) {
                    return `Price: $${context.parsed.y}`;
                  }
                  return `${context.dataset.label}: ${context.parsed.y}%`;
                }
              }
            }
          },
          scales: {
            x: { grid: { display: true, color: 'rgba(0, 0, 0, 0.1)' }},
            y: {
              beginAtZero: false,
              grid: { display: true, color: 'rgba(0, 0, 0, 0.1)' },
              ticks: {
                callback: yLabel
              }
            }
          },
          interaction: {
            mode: 'nearest',
            axis: 'x',
            intersect: false
          }
        }
      });
    }

    return () => {
      if (chartInstance.current) {
        chartInstance.current.destroy();
      }
    };
  }, [comparisonData, showSP500]);

  const handleSearchChange = async (e) => {
    const val = e.target.value.toUpperCase();
    setSearch(val);
    if (val.length > 1) {
      try {
        const data = await searchSymbols(val);
        setSuggestions(data);
      } catch (error) {
        setSuggestions([]);
      }
    } else {
      setSuggestions([]);
    }
  };

  const handleSuggestionClick = (sym) => {
    navigate(`/dashboard/${sym}`);
    setSearch('');
    setSuggestions([]);
  };

  const handlePeriodChange = (newPeriod) => {
    setPeriod(newPeriod);
  };

  // Show price and price change for selected period from comparisonData
  const renderPeriodPriceChange = () => {
    if (!comparisonData) return null;
    const isPositive = comparisonData.price_change >= 0;
    return (
      <div className={`price-change ${isPositive ? 'positive' : 'negative'}`}>
        {isPositive ? '+' : ''}{comparisonData.price_change} ({isPositive ? '+' : ''}{comparisonData.price_change_percent}%)
      </div>
    );
  };

  return (
    <div className="dashboard-container">
      <header className="dashboard-header">
        <h1 className="logo">MarkeTracker</h1>
        <div className="search-container">
          <input
            type="text"
            className="search-input"
            placeholder="Search for a stock symbol..."
            value={search}
            onChange={handleSearchChange}
          />
          {suggestions.length > 0 && (
            <ul className="suggestions-list">
              {suggestions.map((s) => (
                <li key={s.symbol} onClick={() => handleSuggestionClick(s.symbol)}>
                  <strong>{s.symbol}</strong> - {s.name}
                </li>
              ))}
            </ul>
          )}
        </div>
      </header>

      {error && <div className="error">{error}</div>}
      {!dashboardData && !error && <div className="loading">Loading Dashboard...</div>}

      {dashboardData && (
        <>
          <main className="main-content">
            <div className="stock-header">
              <h1 className="stock-name">{dashboardData.longName}({symbol})</h1>
              <div className="price-info">
                {/* Show the last price in the period from comparisonData if available */}
                <div className="current-price">
                  {comparisonData && typeof comparisonData.end_price === 'number'
                    ? `$${comparisonData.end_price}`
                    : 'N/A'}
                </div>
                {renderPeriodPriceChange()}
              </div>
            </div>

            <div className="chart-container">
              <div className="chart-header">
                <div className="chart-title">Performance vs. S&P 500</div>
                <div className="chart-controls">
                  <div className="period-buttons">
                    {['1d', '5d', '1mo', '3mo', '6mo', '1y', '2y', 'max'].map(p => (
                      <button 
                        key={p} 
                        className={`period-btn ${period === p ? 'active' : ''}`} 
                        onClick={() => handlePeriodChange(p)}
                      >
                        {p.toUpperCase()}
                      </button>
                    ))}
                  </div>
                  <button 
                    className={`toggle-btn ${showSP500 ? 'active' : ''}`}
                    onClick={() => setShowSP500(!showSP500)}
                  >
                    {showSP500 ? 'Hide S&P 500' : 'Compare S&P 500'}
                  </button>
                </div>
              </div>
              <div style={{ height: '400px' }}>
                <canvas ref={chartRef}></canvas>
              </div>
            </div>

            <div className="dashboard-metrics-section">
              <h3 className="section-title">Key Metrics</h3>
              <div className="metrics-grid">
                <div className="metric"><span className="label">Sector:</span><span className="value">{dashboardData.sector || 'N/A'}</span></div>
                <div className="metric"><span className="label">Industry:</span><span className="value">{dashboardData.industry || 'N/A'}</span></div>
                <div className="metric"><span className="label">Market Cap:</span><span className="value">{dashboardData.marketCap || 'N/A'}</span></div>
                <div className="metric"><span className="label">Day High / Low:</span><span className="value">${dashboardData.regularMarketDayHigh?.toFixed(2) || 'N/A'} / ${dashboardData.regularMarketDayLow?.toFixed(2) || 'N/A'}</span></div>
                <div className="metric"><span className="label">52-Week High / Low:</span><span className="value">${dashboardData.fiftyTwoWeekHigh?.toFixed(2) || 'N/A'} / ${dashboardData.fiftyTwoWeekLow?.toFixed(2) || 'N/A'}</span></div>
                <div className="metric"><span className="label">Website:</span><span className="value"><a href={dashboardData.website} target="_blank" rel="noopener noreferrer">Visit Official Website</a></span></div>
              </div>

              <h3 className="section-title">Valuation & Rating</h3>
              <div className="metrics-grid">
                <div className="metric"><span className="label">P/E Ratio (Trailing)</span><span className="value">{dashboardData.trailingPE?.toFixed(2) || 'N/A'}</span></div>
                <div className="metric"><span className="label">EPS (Trailing)</span><span className="value">{dashboardData.trailingEps?.toFixed(2) || 'N/A'}</span></div>
                <div className="metric"><span className="label">Dividend Yield</span><span className="value">{dashboardData.dividendYield ? `${(dashboardData.dividendYield).toFixed(2)}%` : 'N/A'}</span></div>
                <div className="metric"><span className="label">Mean Target Price</span><span className="value">${dashboardData.targetMeanPrice?.toFixed(2) || 'N/A'}</span></div>
                <div className="metric"><span className="label">Analyst Rating</span><span className="value">{dashboardData.averageAnalystRating || 'N/A'}</span></div>
                <div className="metric metric-forecast">
                  <span className="label">ML Price Forecast (Educational)</span>
                  <span className="value">{dashboardData.forecast_price ? `$${dashboardData.forecast_price.toFixed(2)}` : 'Not Available'}</span>
                </div>
              </div>

            <h3 className="section-title">Business Summary</h3>
              <div className="business-summary">
                <p>{dashboardData.longBusinessSummary || 'No summary available.'}</p>
              </div>

              <h3 className="section-title">Quarterly Income Statement</h3>
              <div className="income-statement-grid">
                {dashboardData.income_grid_items && dashboardData.income_grid_items.length > 0 ? (
                  dashboardData.income_grid_items.map((item, idx) => (
                    <div key={idx} className={`income-item ${item.css_class}`}>
                      <span className="item-label">{item.label}</span>
                      <span className="item-value">{item.value}</span>
                    </div>
                  ))
                ) : (
                  <p>Income statement data is not available.</p>
                )}
              </div>
            </div>
          </main>
        </>
      )}
    </div>
  );
};

export default Dashboard;
