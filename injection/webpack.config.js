/* eslint-disable */

const fs = require('fs');
const path = require('path');
const webpack = require('webpack');
const TsconfigPathsPlugin = require('tsconfig-paths-webpack-plugin');

const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../popup/public/manifest.json'), 'utf8'));

module.exports = {
  entry: './src/index.ts',
  mode: 'production',
  output: {
    filename: '[name].js',
    path: path.resolve(__dirname, 'dist'),
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
    ],
  },
  plugins: [
    new webpack.DefinePlugin({ __VTT_VERSION__: JSON.stringify(manifest.version) }),
  ],
  resolve: {
    plugins: [new TsconfigPathsPlugin({
      configFile: './tsconfig.json',
    })],
    extensions: ['.tsx', '.ts', '.js'],
  },
};