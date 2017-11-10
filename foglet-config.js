module.exports = {
  browsers: [ "Firefox" ],
  timeout: 20000,
  lint: true,
  build: {
    entry: './foglet-overlay.js',
    output: {
      "path": require('path').resolve(process.cwd(), 'dist'),
      "filename": "overlay.bundle.js",
      "library": "overlay",
      "libraryTarget": "umd",
      "umdNamedDefine": true
    },
    module: {
      rules: [
        {
          test: /\.js$/,
          exclude: (url) => {
            return true;
          },
          use: {
            loader: 'babel-loader',
            options: {
              presets: ['env']
            }
          }
        }
      ]
    },
    devtool: 'source-map'
  }
}