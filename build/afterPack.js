'use strict';
/**
 * electron-builder afterPack hook (Windows): sets the app icon and version info on
 * the .exe with a pure-JS resource editor, so building on Linux/macOS needs no Wine.
 */
const fs = require('fs');
const path = require('path');

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const ResEdit = await import('resedit');
  const { NtExecutable, NtExecutableResource, Data, Resource } = ResEdit.default || ResEdit;
  const pkg = context.packager.appInfo;
  const exePath = path.join(context.appOutDir, `${pkg.productFilename}.exe`);
  const iconPath = path.join(context.packager.projectDir, 'assets', 'icon.ico');

  const exe = NtExecutable.from(fs.readFileSync(exePath));
  const res = NtExecutableResource.from(exe);

  const iconFile = Data.IconFile.from(fs.readFileSync(iconPath));
  const groups = Resource.IconGroupEntry.fromEntries(res.entries);
  const groupId = groups.length ? groups[0].id : 1;
  const lang = groups.length ? groups[0].lang : 1033;
  Resource.IconGroupEntry.replaceIconsForResource(res.entries, groupId, lang, iconFile.icons.map((i) => i.data));

  const [vi] = Resource.VersionInfo.fromEntries(res.entries);
  if (vi) {
    const v = pkg.version.split('.').map(Number);
    vi.setFileVersion(v[0] || 0, v[1] || 0, v[2] || 0, 0, 1033);
    vi.setProductVersion(v[0] || 0, v[1] || 0, v[2] || 0, 0, 1033);
    vi.setStringValues({ lang: 1033, codepage: 1200 }, {
      ProductName: pkg.productName,
      FileDescription: pkg.productName,
      CompanyName: pkg.companyName || '',
      OriginalFilename: `${pkg.productFilename}.exe`,
    });
    vi.outputToResourceEntries(res.entries);
  }

  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
  console.log(`  • afterPack: icon + version info set on ${path.basename(exePath)}`);
};
