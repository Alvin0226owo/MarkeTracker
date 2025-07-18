from flask import Flask, request, jsonify
from flask_caching import Cache
import pandas as pd
from sklearn.linear_model import LinearRegression
import yfinance as yf
import humanize

app = Flask(__name__)

# Configure cache
app.config['CACHE_TYPE'] = 'SimpleCache'
app.config['CACHE_DEFAULT_TIMEOUT'] = 300  # 5 minutes

cache = Cache(app)

# Helper: Price Forecast

@cache.memoize(timeout=3600) # Cache for 1 hour
def get_price_forecast(symbol):
    try:
        stock = yf.Ticker(symbol)
        df = stock.history(period="2y")
        if df.empty:
            return None
        df["Target"] = df["Close"].shift(-1)
        df = df.dropna()  # FIX: remove inplace=True and assign result
        features = ['Open','High','Low','Close','Volume']
        X = df[features]
        y = df["Target"]
        model = LinearRegression()
        model.fit(X, y)
        last_day_features = df[features].iloc[-1:]
        forecast = model.predict(last_day_features)
        return forecast[0]
    except Exception as e:
        print(f"Error in get_price_forecast for {symbol}: {str(e)}")
        return None

# Helper: Income Grid

def create_income_grid_data(df):
    income_items = []
    latest_quarter = df.columns[0] if len(df.columns) > 0 else None
    if latest_quarter is None:
        return income_items
    positive_items = ['Total Revenue', 'Gross Profit', 'Operating Income', 'Net Income',
                     'Interest Income', 'Other Income Expense', 'Pretax Income']
    negative_items = ['Total Expenses', 'Operating Expense', 'Cost Of Revenue',
                     'Interest Expense', 'Tax Provision', 'Research And Development',
                     'Selling General And Administration']
    for index, row in df.iterrows():
        if pd.isna(row[latest_quarter]) or row[latest_quarter] == 0:
            continue
        value = row[latest_quarter]
        css_class = ""
        if any(pos_item.lower() in str(index).lower() for pos_item in positive_items):
            css_class = "positive"
        elif any(neg_item.lower() in str(index).lower() for neg_item in negative_items):
            css_class = "negative"
        if isinstance(value, (int, float)):
            if abs(value) >= 1e9:
                formatted_value = f"${value/1e9:.2f}B"
            elif abs(value) >= 1e6:
                formatted_value = f"${value/1e6:.2f}M"
            elif abs(value) >= 1e3:
                formatted_value = f"${value/1e3:.2f}K"
            else:
                formatted_value = f"${value:.2f}"
        else:
            formatted_value = str(value)
        income_items.append({
            'label': str(index).replace('_', ' ').title(),
            'value': formatted_value,
            'css_class': css_class,
            'raw_value': value
        })
    return income_items

# Endpoint: Comparison
@app.route('/api/comparison/<symbol>', methods=['GET'])
def get_comparison_data(symbol):
    period = request.args.get('period', '1y')
    data, error, status_code = get_comparison_data_for_period(symbol, period)
    if error:
        return jsonify({'error': error}), status_code
    return jsonify(data)

def get_comparison_data_for_period(symbol,period):
    try:
        interval = get_interval_for_period(period)
        if not interval:
            return None, "Invalid period specified", 400
        
        stock_hist = yf.Ticker(symbol).history(period=period,interval=interval)
        sp500_hist = yf.Ticker("^GSPC").history(period=period,interval=interval)
        if stock_hist.empty or sp500_hist.empty:
            return None
        combined_df = pd.DataFrame({
            'stock': stock_hist['Close'],
            'sp500': sp500_hist['Close']
        })
        combined_df.ffill(inplace=True)
        combined_df.dropna(inplace=True)
        if combined_df.empty:
            return None
        performance_df = (combined_df / combined_df.iloc[0] - 1) * 100

        stock_start_price = float(stock_hist['Close'].iloc[0])
        stock_end_price = float(stock_hist['Close'].iloc[-1])
        price_change = stock_end_price - stock_start_price
        price_change_percent = (price_change / stock_start_price) * 100 if stock_start_price != 0 else 0
        if period == '1d' or period == '5d':
            dates = performance_df.index.strftime('%m-%d %H:%M').tolist()
        else:
            dates = performance_df.index.strftime('%Y-%m-%d').tolist()

        data = {
            "dates" : dates,
            "stock_prices" : stock_hist['Close'].round(2).tolist(),
            "price_change" : round(price_change, 2),
            "price_change_percent" : round(price_change_percent, 2),
            "stock_performance": performance_df['stock'].round(2).tolist(),
            "sp500_performance": performance_df['sp500'].round(2).tolist(),
            "end_price" : round(float(stock_hist['Close'].iloc[-1]), 2),
            'stock_symbol': symbol.upper(),
            'sp500_symbol': 'S&P 500'
        }

        return (data,None,200)

    except Exception as e:
        print(f"Error in get_comparison_data_for_period for {symbol} ({period}): {str(e)}")
        return None, str(e), 500

def get_interval_for_period(period):
    mapping = {
        '1d': "2m",
        '5d': "30m",
        '1mo': "1h",
        '3mo': "90m",
        '6mo': "1d",
        '1y': "1d",
        '2y': "5d",
        'max': "3mo",
    }

    return mapping.get(period)

# Endpoint: Dashboard
@app.route('/api/dashboard/<symbol>', methods=['GET'])
@cache.memoize(timeout=300) # Cache for 5 minutes
def api_dashboard(symbol):
    try:
        if not symbol:
            return jsonify({'error': 'No symbol provided'}), 400
        
        stock = yf.Ticker(symbol)
        stock_info = stock.info

        dashboard_data = {key: stock_info.get(key) for key in [
            'longName', 'sector', 'industry', 'website', 'marketCap',
            'trailingPE', 'trailingEps', 'dividendYield', 'targetMeanPrice',
            'averageAnalystRating', 'regularMarketPrice', 'regularMarketOpen',
            'regularMarketDayHigh', 'regularMarketDayLow', 'regularMarketPreviousClose',
            'fiftyTwoWeekHigh', 'fiftyTwoWeekLow', 'longBusinessSummary'
        ]}

        # Add custom-calculated fields
        dashboard_data['forecast_price'] = get_price_forecast(symbol)
        dashboard_data['marketCap'] = humanize.intword(dashboard_data.get('marketCap', 0))

        q_income_stmt = stock.quarterly_income_stmt
        if not q_income_stmt.empty:
            q_income_stmt.columns = q_income_stmt.columns.strftime('%Y-%m-%d')
            dashboard_data['income_grid_items'] = create_income_grid_data(q_income_stmt)
        else:
            dashboard_data['income_grid_items'] = []

    except Exception as e:
        print(f"Error fetching dashboard data for {symbol}: {str(e)}")
        return jsonify({'error': str(e)}), 500
    
    return jsonify(dashboard_data)

@app.route('/testbackend', methods=['GET'])
def test_backend():
    return jsonify({'message': 'Test backend is working!'})

if __name__ == '__main__':
    app.run(debug=True)
