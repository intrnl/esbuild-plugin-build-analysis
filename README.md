Performs build-time analysis on esbuild

## Dynamic import preloading

Allows for preloading the dependencies of dynamically loaded modules.

```js
// main.js
import('./dynamic-import.js');

// dynamic-import.js
import './foo.js';
import './bar.js';
```

```js
// roughly converted to:
__preload(() => import('./dynamic-import.js'), ['./dynamic-import.js', './foo.js', './bar.js']);
```
