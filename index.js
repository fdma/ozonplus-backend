// server.js

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const axios = require('axios');
const winston = require('winston');
const fs = require('fs');
const path = require('path');
const { parseApplicability } = require('./parseApplicability');

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message }) => `${timestamp} ${level}: ${message}`)
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'app.log' })
    ],
});

const ozonClientId = '1803189';
const ozonApiKey = 'e599e180-4910-42e7-b287-ac34385e64d6';
const ozonCreateProductUrl = 'https://api-seller.ozon.ru/v3/product/import';

const productsFilePath = path.join(__dirname, 'products.json');

const readProductsFromFile = () => {
    try {
        const data = fs.readFileSync(productsFilePath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        logger.error('Ошибка чтения файла продуктов:', error.message);
        return [];
    }
};

const writeProductsToFile = (products) => {
    try {
        fs.writeFileSync(productsFilePath, JSON.stringify(products, null, 2));
    } catch (error) {
        logger.error('Ошибка записи файла продуктов:', error.message);
    }
};

function transformApplicabilityDataToOzonFormat(applicabilityData) {
    const ozonItems = [];

    applicabilityData.forEach(item => {
        const brand = 'LYNXAuto';
        const price = '1000';
        const partnumber = item.data.article;

        item.data.models.forEach((model, index) => {
            const imageUrl = `https://lynxauto.info/image/${partnumber}.jpg`;
            const ozonItem = {
                attributes: [
                    {
                        attribute_complex_id: 0,
                        id: 85,
                        values: [
                            {
                                value: brand || "Нет бренда"
                            }
                        ]
                    },
                    {
                        attribute_complex_id: 0,
                        id: 7236,
                        values: [
                            {
                                value: partnumber
                            }
                        ]
                    },
                    {
                        attribute_complex_id: 0,
                        id: 8229,
                        values: [
                            {
                                value: "Лампа автомобильная",
                                dictionary_id: 1960
                            }
                        ]
                    },
                    {
                        attribute_complex_id: 0,
                        id: 9024,
                        values: [
                            {
                                value: partnumber
                            }
                        ]
                    },
                    {
                        attribute_complex_id: 0,
                        id: 9048,
                        values: [
                            {
                                value: model
                            }
                        ]
                    },
                ],
                barcode: "112772873170",
                description_category_id: 17028756,
                color_image: "",
                complex_attributes: [],
                currency_code: "RUB",
                depth: 10,
                dimension_unit: "mm",
                height: 250,
                images: [imageUrl],
                images360: [],
                name: `${item.manufacturer} ${model}`, // Добавляем производителя и модель в название
                offer_id: `${partnumber}_${index}`,
                old_price: "1100",
                price: price,
                primary_image: imageUrl,
                vat: "0.1",
                weight: 100,
                weight_unit: "g",
                width: 150
            };

            ozonItems.push(ozonItem);
        });
    });

    return ozonItems;
}

async function createOzonProducts(ozonData) {
    if (!ozonData) {
        logger.error('Недействительные данные Ozon');
        return;
    }

    try {
        const response = await axios.post(ozonCreateProductUrl, { items: ozonData }, {
            headers: {
                'Client-Id': ozonClientId,
                'Api-Key': ozonApiKey,
                'Content-Type': 'application/json',
            },
        });

        logger.info('Продукты успешно созданы в Ozon:', response.data);
    } catch (error) {
        logger.error('Ошибка создания продуктов в Ozon:', error.response ? error.response.data : error.message);
    }
}

const app = express();
const port = 3001;

app.use(cors());
app.use(bodyParser.json());

app.post('/api/create-products', async (req, res) => {
    const { url, limit } = req.body;

    logger.info(`Received URL: ${url}, limit: ${limit}`);

    try {
        const applicabilityData = await parseApplicability(url);
        const ozonData = transformApplicabilityDataToOzonFormat(applicabilityData);

        if (ozonData) {
            const limitedOzonData = ozonData.slice(0, limit);
            await createOzonProducts(limitedOzonData);
            logger.info('Data successfully sent to Ozon');

            const products = readProductsFromFile();
            products.push(...limitedOzonData);
            writeProductsToFile(products);

            res.status(200).send({ message: 'Products uploaded successfully!', products: limitedOzonData });
        } else {
            logger.error('Ozon data transformation failed');
            res.status(500).send({ message: 'Ozon data transformation failed' });
        }
    } catch (error) {
        logger.error(`Error: ${error.message}`);
        res.status(500).send({ message: 'Failed to upload products', error: error.message });
    }
});

app.get('/api/products', (req, res) => {
    const searchQuery = req.query.search;
    let products = readProductsFromFile();
    if (searchQuery) {
        products = products.filter(product => 
            product.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            product.article.toLowerCase().includes(searchQuery.toLowerCase())
        );
    }
    res.status(200).send(products);
});

app.get('/api/categories', (req, res) => {
    res.status(200).send([]);
});

app.delete('/api/products/:guid', (req, res) => {
    const { guid } = req.params;
    let products = readProductsFromFile();
    const updatedProducts = products.filter(product => product.offer_id !== guid);
    writeProductsToFile(updatedProducts);
    res.status(200).send({ message: 'Product deleted successfully' });
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
