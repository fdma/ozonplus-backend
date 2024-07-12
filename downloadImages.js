// downloadImages.js

const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Функция для загрузки изображения по артикулу
async function downloadImage(article) {
    const url = `https://lynxauto.info/image/${article}.jpg`;
    const filePath = path.resolve(__dirname, 'images', `${article}.jpg`);

    if (fs.existsSync(filePath)) {
        console.log(`Изображение ${article} уже существует. Пропуск загрузки.`);
        return filePath;
    }

    try {
        const response = await axios({
            url,
            method: 'GET',
            responseType: 'stream'
        });

        // Создаем папку, если она не существует
        fs.mkdirSync(path.dirname(filePath), { recursive: true });

        // Сохраняем изображение в файл
        const writer = fs.createWriteStream(filePath);
        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', () => {
                console.log(`Изображение ${article} успешно сохранено.`);
                resolve(filePath);
            });
            writer.on('error', (error) => {
                console.error(`Ошибка при загрузке изображения ${article}:`, error.message);
                reject(error);
            });
        });
    } catch (error) {
        console.error(`Ошибка при загрузке изображения ${article}:`, error.message);
    }
}

module.exports = { downloadImage };
