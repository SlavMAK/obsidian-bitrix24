import { TFile, Vault, normalizePath, requestUrl } from 'obsidian';

/**
 * Универсально скачивает файл из указанного URL и сохраняет его в хранилище Obsidian
 * Работает с любыми типами файлов (текстовыми и бинарными)
 * 
 * @param vault Хранилище Obsidian
 * @param url URL файла для скачивания
 * @param localPath Путь для сохранения файла в Obsidian
 * @param headers Дополнительные HTTP-заголовки для запроса (если нужны)
 * @returns Promise с результатом операции
 */
export async function universalDownloadFile(
  vault: Vault, 
  url: string, 
  localPath: string, 
  headers: Record<string, string> = {},
  additionalParams: Record<string, string|number> = {}
): Promise<boolean> {
  try {
    const normalizedPath = normalizePath(localPath);
    
    // Проверяем директорию
    const lastSlashIndex = normalizedPath.lastIndexOf('/');
    if (lastSlashIndex > 0) {
      const dirPath = normalizedPath.substring(0, lastSlashIndex);
      const dirExists = await vault.adapter.exists(dirPath);
      if (!dirExists) {
        await vault.createFolder(dirPath);
      }
    }
    
    // Используем request из Obsidian API    
    const response = await requestUrl({
      url: url,
      method: 'GET',
      headers: {
        'Accept': '*/*',
        ...headers
      }
    });
    
    // Получаем бинарные данные из ответа
    // В Obsidian до версии 0.14.x использовался .arrayBuffer
    // В новых версиях доступен .arrayBuffer
    const arrayBuffer = response.arrayBuffer;
    
    // Преобразуем ArrayBuffer в Uint8Array
    const fileData = new Uint8Array(arrayBuffer);

    const mtime=Number(additionalParams?.mtime)||new Date().getTime();
    
    // Сохраняем файл
    if (await vault.adapter.exists(normalizedPath)) {
      const fileAbstract=vault.getAbstractFileByPath(normalizedPath) as TFile;
      await vault.modifyBinary(fileAbstract, fileData, {mtime});
    }
    else{
      await vault.createBinary(normalizedPath, fileData, {mtime});
    }
    
    return true;
  } catch (error) {
    console.error(`Error downloading file to ${localPath}:`, error);
    return false;
  }
}
