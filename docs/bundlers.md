# Modern Bundlers (Vite / Rollup / Webpack) & Subdirectory Previews

When building Storybook with modern bundlers (such as `@storybook/vue3-vite`, `@storybook/react-vite`, `@storybook/svelte-vite`, or Webpack 5) for deployment to GitHub Pages root and PR preview subdirectories (`/pr-preview/pr-<number>/`), keep these two configurations in mind:

### 1. Relative Asset URLs (`base: './'`)

By default, Storybook builds might assume root-level serving (`/`). When publishing to a subdirectory on GitHub Pages (e.g. `https://<owner>.github.io/<repo>/pr-preview/pr-42/`), absolute asset paths like `/assets/...` will fail or point to the root domain.

To make your static Storybook build portable across both root production and PR preview subdirectories without needing different build commands, set `base: './'` in your Storybook configuration:

**For Vite frameworks (`.storybook/main.ts`):**

```typescript
import type { StorybookConfig } from '@storybook/vue3-vite'; // or @storybook/react-vite, @storybook/svelte-vite

const config: StorybookConfig = {
  stories: ['../src/**/*.mdx', '../src/**/*.stories.@(js|jsx|mjs|ts|tsx)'],
  addons: ['@storybook/addon-essentials', '@storybook/addon-a11y'],
  framework: {
    name: '@storybook/vue3-vite',
    options: {}
  },
  async viteFinal(config) {
    return {
      ...config,
      base: './' // Ensures relative asset resolution for scripts, styles, and iframe
    };
  }
};

export default config;
```

**For Webpack frameworks (`.storybook/main.ts`):**

```typescript
import type { StorybookConfig } from '@storybook/react-webpack5';

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(js|jsx|ts|tsx)'],
  addons: ['@storybook/addon-essentials'],
  framework: '@storybook/react-webpack5',
  async webpackFinal(config) {
    config.output = {
      ...config.output,
      publicPath: './'
    };
    return config;
  }
};

export default config;
```

### 2. Automatic `.nojekyll` Handling

Vite and Rollup often generate vendor chunks with leading underscores (e.g. `_plugin-vue_export-helper.js` or `_commonjsHelpers.js`). GitHub Pages runs Jekyll by default, which ignores any file or folder starting with an underscore (`_`), causing HTTP 404 errors on dynamic imports.

`storybook-github-pages` **automatically** creates and preserves `.nojekyll` files at both the Pages root and inside artifact packages. You do not need to manually create `.nojekyll` in your source repository.

> 💡 **Live Reference Implementation:** See [Archetipo95/storybook-vue-demo](https://github.com/Archetipo95/storybook-vue-demo) for a complete working example with Vue 3.5, Storybook 10, Vite 8, and automated PR previews.

---
