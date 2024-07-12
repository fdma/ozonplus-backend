const puppeteer = require('puppeteer');

// Функция для создания задержки
function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Функция для парсинга данных
async function parseApplicability(url) {
    const browser = await puppeteer.launch({ headless: false });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle0' });

    try {
        const manufacturers = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('.pcard-list-mark-item')).map(el => el.textContent.trim());
        });

        const applicabilityData = [];

        for (let i = 0; i < manufacturers.length; i++) {
            await page.click(`.pcard-list-mark-item:nth-child(${i + 1})`);
            await page.waitForSelector('.dialog-applicability', { visible: true });

            const data = await page.evaluate(() => {
                const models = Array.from(document.querySelectorAll('.la_model')).map(el => el.textContent.trim());
                const engines = Array.from(document.querySelectorAll('.la_engine')).map(el => el.textContent.trim());
                const powerEngines = Array.from(document.querySelectorAll('.la_power_engine')).map(el => el.textContent.trim());
                const modelYears = Array.from(document.querySelectorAll('.la_model_year')).map(el => el.textContent.trim());
                const article = document.querySelector('.pcard-model').textContent.trim();

                return { models, engines, powerEngines, modelYears, article };
            });

            applicabilityData.push({
                manufacturer: manufacturers[i],
                data
            });

            await page.click('.close_btn.dialog-applicability-close');
            await wait(1000); // Ждем немного, чтобы диалог закрылся
        }

        return applicabilityData;
    } catch (error) {
        console.error('Ошибка при парсинге:', error.message);
        throw error;
    } finally {
        await browser.close();
    }
}   

module.exports = { parseApplicability };