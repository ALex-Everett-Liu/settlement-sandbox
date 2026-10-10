import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './styles.css';

const host = document.getElementById('root');
if (!host) throw new Error('页面上没有 #root');
createRoot(host).render(<App />);
