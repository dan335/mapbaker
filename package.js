Package.describe({
  name: 'danimal:mapbaker',
  summary: 'Map baker for Dominus http://dominusgame.net',
  version: '1.0.11',
  git: 'https://github.com/dan335/mapbaker'
});

Package.onUse(function(api) {
  api.versionsFrom('1.0.2.1');
  api.use('classcraft:knox@0.9.11')
  api.use('danimal:hx@1.0.6')
  api.use('http', 'server')
  api.addFiles('mapbaker.js');
  api.export('Mapbaker', 'server')
});

Npm.depends({
    svgexport: '0.1.14'
})
