import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// NOTE: <React.StrictMode> is intentionally NOT used. Its simulated
// mount/unmount cycle runs effect cleanups on first mount, which would
// destroy the singleton VoiceEngine (media/WASM state) before the user
// ever clicks the mic. Real unmount cleanup is preserved in the hook.
ReactDOM.createRoot(document.getElementById('root')!).render(<App />);

