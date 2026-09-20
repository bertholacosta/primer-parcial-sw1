import '@testing-library/jest-dom';

// Polyfill ResizeObserver for @xyflow/react in jsdom environment
if (typeof window !== 'undefined' && !window.ResizeObserver) {
  window.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
