import { access } from 'node:fs/promises';
import path from 'node:path';

export async function patchExecutableIcon(executablePath, iconPath, productName) {
  try {
    await access(iconPath);
  } catch {
    console.warn(`WARN: Иконка не найдена (${path.relative(process.cwd(), iconPath)}); используется текущая иконка EXE.`);
    return false;
  }

  try {
    const { rcedit } = await import('rcedit');
    await rcedit(path.resolve(executablePath), {
      icon: path.resolve(iconPath),
      'version-string': {
        CompanyName: 'HomeAuction',
        FileDescription: productName,
        ProductName: 'HomeAuction'
      }
    });
    return true;
  } catch (error) {
    console.warn(`WARN: Не удалось заменить иконку EXE (${error.message}); используется текущая иконка.`);
    return false;
  }
}
