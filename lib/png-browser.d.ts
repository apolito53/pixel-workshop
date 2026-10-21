declare module 'pngjs/browser.js' {
  import { PNG } from 'pngjs';
  const pngjs:{PNG:typeof PNG};
  export default pngjs;
}
