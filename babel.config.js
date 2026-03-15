module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      [
        'module-resolver',
        {
          root: ['.'],
          extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
          alias: {
            // Mirror every path in tsconfig.json exactly
            '@':          './src',
            '@ui':        './src/components/ui',
            '@layout':    './src/components/layout',
            '@features':  './src/features',
            '@services':  './src/services',
            '@stores':    './src/stores',
            '@hooks':     './src/hooks',
            '@app-types': './src/types',
            '@constants': './src/constants',
            '@utils':     './src/utils',
          },
        },
      ],
    ],
  };
};
