// parser.js

const puppeteer = require('puppeteer');
const axios = require('axios');
const cheerio = require('cheerio');

// Функция для получения информации о товаре
async function getProductInfo(article) {
    const url = `https://lynxauto.info/index.php?route=product/search&search=${article}`;
    const browser = await puppeteer.launch({ headless: false });  // Отключаем headless режим для визуального контроля
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle0' });

    try {
        // Парсим данные о товаре
        const productInfo = await page.evaluate(() => {
            const productElement = document.querySelector('.pcard-info');
            const compatibilityButton = document.querySelector('.btn-compatibility');
            const imageElement = document.querySelector('.pcard-images img');
            if (!productElement || !imageElement) throw new Error('Required elements not found');
            return { 
                productName: productElement.textContent.trim(),
                compatibilityButtonLink: compatibilityButton ? compatibilityButton.href : null,
                imageUrl: imageElement.src
            };
        });
        await browser.close();
        return productInfo;
    } catch (error) {
        const content = await page.content();
        console.log(content);  // Логируем HTML-код страницы для отладки
        await browser.close();
        throw error;
    }
}

// Функция для получения совместимости автомобилей
async function getCompatibility(link) {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    await page.goto(link, { waitUntil: 'networkidle0' });

    try {
        // Парсим данные о совместимости
        const compatibility = await page.evaluate(() => {
            const rows = Array.from(document.querySelectorAll('.compatibility-table tr'));
            return rows.map(row => {
                const cols = row.querySelectorAll('td');
                return {
                    manufacturer: cols[0]?.textContent.trim(),
                    model: cols[1]?.textContent.trim(),
                    modification: cols[2]?.textContent.trim()
                };
            });
        });
        await browser.close();
        return compatibility;
    } catch (error) {
        await browser.close();
        throw error;
    }
}

// Основная функция
(async () => {
    const article = 'BC-2044';
    try {
        const productInfo = await getProductInfo(article);

        if (productInfo.compatibilityButtonLink) {
            const compatibility = await getCompatibility(productInfo.compatibilityButtonLink);
            console.log(`Товар: ${productInfo.productName}`);
            console.log('Совместимость:', compatibility);
        } else {
            console.log(`Товар: ${productInfo.productName}`);
            console.log('Совместимость: не найдена');
        }

        // Выводим ссылку на изображение
        console.log(`Изображение: ${productInfo.imageUrl}`);
    } catch (error) {
        console.error('Ошибка при парсинге:', error.message);
    }
})();
