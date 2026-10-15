import { StrictMode, Component } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    console.error("ErrorBoundary caught error:", error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center justify-center p-6 text-center">
          <div className="bg-gray-800 border border-gray-700 p-8 rounded-2xl max-w-md w-full shadow-2xl">
            <h2 className="text-xl font-bold text-orange-400 mb-3">表示エラーが発生しました</h2>
            <p className="text-sm text-gray-300 mb-6 leading-relaxed">
              ファイルの読み込み中に問題が発生した可能性があります。<br />
              再読み込みをお試しください。
            </p>
            <button
              onClick={() => {
                this.setState({ hasError: false });
                window.location.reload();
              }}
              className="px-6 py-2.5 bg-orange-600 hover:bg-orange-500 text-white rounded-xl font-bold transition-all shadow-lg shadow-orange-600/30 cursor-pointer"
            >
              ページを再読み込み
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)

