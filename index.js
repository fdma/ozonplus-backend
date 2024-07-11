const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const axios = require('axios');
const xml2js = require('xml2js');
const winston = require('winston');
const fs = require('fs');
const path = require('path');

const categories = [
    {
        name: 'Лампы',
        subcategories: [
            'Колпачок на лампу',
            'Лампа габаритного освещения',
            'Лампа головного света',
            'Лампа панели приборов',
            'Лампа противотуманной фары',
            'Лампа салона',
            'Лампа специального назначения',
            'Лампы прочие'
        ]
    }
];

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

const rosskoApiKey1 = '2a9350827cddf81bc5e625bd97026c40';
const rosskoApiKey2 = 'ecb6ed55070ed90f4c4e9122cc7a0806';
const ozonClientId = '1803189';
const ozonApiKey = 'e599e180-4910-42e7-b287-ac34385e64d6';

const API_BASE_URL = 'http://api.rossko.ru/service/v2.1/';
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

async function getDeliveryDetails() {
    try {
        const response = await axios.post(`${API_BASE_URL}GetCheckoutDetails`, 
            `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="http://api.rossko.ru/">
                <soapenv:Header/>
                <soapenv:Body>
                    <ser:GetCheckoutDetails>
                        <ser:KEY1>${rosskoApiKey1}</ser:KEY1>
                        <ser:KEY2>${rosskoApiKey2}</ser:KEY2>
                    </ser:GetCheckoutDetails>
                </soapenv:Body>
            </soapenv:Envelope>`, {
            headers: {
                'Content-Type': 'text/xml'
            }
        });

        const result = await xml2js.parseStringPromise(response.data);
        logger.info('Parsed XML for Delivery Details:', JSON.stringify(result, null, 2));

        const deliveryAddresses = result['SOAP-ENV:Envelope']['SOAP-ENV:Body'][0]['ns1:GetCheckoutDetailsResponse'][0]['ns1:CheckoutDetailsResult'][0]['ns1:DeliveryAddress'];
        const address = deliveryAddresses[0]['ns1:address'][0];
        const deliveryIdsArray = address['ns1:Delivery'][0]['ns1:ids'][0]['ns1:id'];

        return {
            deliveryIds: deliveryIdsArray,
            addressId: address['ns1:id'][0]
        };
    } catch (error) {
        logger.error('Ошибка при получении типов доставки:', error.message);
        return null;
    }
}

async function getRosskoData(query, deliveryId, addressId, limit) {
    const soapEnvelope = 
        `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="http://api.rossko.ru/">
            <soapenv:Header/>
            <soapenv:Body>
                <ser:GetSearch>
                    <ser:KEY1>${rosskoApiKey1}</ser:KEY1>
                    <ser:KEY2>${rosskoApiKey2}</ser:KEY2>
                    <ser:text>${query}</ser:text>
                    <ser:delivery_id>${deliveryId}</ser:delivery_id>
                    <ser:address_id>${addressId}</ser:address_id>
                </ser:GetSearch>
            </soapenv:Body>
        </soapenv:Envelope>`;

    try {
        const response = await axios.post(`${API_BASE_URL}GetSearch`, soapEnvelope, {
            headers: {
                'Content-Type': 'text/xml'
            }
        });

        const result = await xml2js.parseStringPromise(response.data);
        logger.info('Parsed XML for GetSearch:', JSON.stringify(result, null, 2));

        if (result['SOAP-ENV:Envelope']['SOAP-ENV:Body'][0]['ns1:GetSearchResponse'][0]['ns1:SearchResult'][0]['ns1:success'][0] === 'true') {
            const partsList = result['SOAP-ENV:Envelope']['SOAP-ENV:Body'][0]['ns1:GetSearchResponse'][0]['ns1:SearchResult'][0]['ns1:PartsList'][0]['ns1:Part'];
            
            logger.info('Parts List:', JSON.stringify(partsList, null, 2));

            const products = partsList.map(part => ({
                guid: part['ns1:guid'][0],
                brand: part['ns1:brand'][0],
                partnumber: part['ns1:partnumber'][0],
                name: part['ns1:name'][0],
                stocks: part['ns1:stocks'][0]['ns1:stock'].map(stock => ({
                    id: stock['ns1:id'][0],
                    price: stock['ns1:price'][0],
                    count: parseInt(stock['ns1:count'][0], 10),
                    multiplicity: parseInt(stock['ns1:multiplicity'][0], 10),
                    type: parseInt(stock['ns1:type'][0], 10),
                    delivery: parseInt(stock['ns1:delivery'][0], 10),
                    extra: parseInt(stock['ns1:extra'][0], 10),
                    description: stock['ns1:description'][0],
                    deliveryStart: stock['ns1:deliveryStart'][0],
                    deliveryEnd: stock['ns1:deliveryEnd'][0]
                }))
            }));

            logger.info('Products:', JSON.stringify(products, null, 2));

            return products;
        } else {
            const message = result['SOAP-ENV:Envelope']['SOAP-ENV:Body'][0]['ns1:GetSearchResponse'][0]['ns1:SearchResult'][0]['ns1:message'][0];
            logger.error('Ошибка Rossko API:', message);
            return null;
        }
    } catch (error) {
        logger.error('Ошибка получения данных от Rossko API:', error.response ? error.response.data : error.message);
        return null;
    }
}

async function getRosskoDataBySubcategory(subcategory, deliveryId, addressId, limit) {
    const soapEnvelope = 
        `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="http://api.rossko.ru/">
            <soapenv:Header/>
            <soapenv:Body>
                <ser:GetSearch>
                    <ser:KEY1>${rosskoApiKey1}</ser:KEY1>
                    <ser:KEY2>${rosskoApiKey2}</ser:KEY2>
                    <ser:text>${subcategory}</ser:text>
                    <ser:delivery_id>${deliveryId}</ser:delivery_id>
                    <ser:address_id>${addressId}</ser:address_id>
                </ser:GetSearch>
            </soapenv:Body>
        </soapenv:Envelope>`;

    try {
        const response = await axios.post(`${API_BASE_URL}GetSearch`, soapEnvelope, {
            headers: {
                'Content-Type': 'text/xml'
            }
        });

        const result = await xml2js.parseStringPromise(response.data);
        logger.info('Parsed XML for GetSearch by subcategory:', JSON.stringify(result, null, 2));

        if (result['SOAP-ENV:Envelope']['SOAP-ENV:Body'][0]['ns1:GetSearchResponse'][0]['ns1:SearchResult'][0]['ns1:success'][0] === 'true') {
            const partsList = result['SOAP-ENV:Envelope']['SOAP-ENV:Body'][0]['ns1:GetSearchResponse'][0]['ns1:SearchResult'][0]['ns1:PartsList'][0]['ns1:Part'];
            
            logger.info('Parts List by subcategory:', JSON.stringify(partsList, null, 2));

            const products = partsList.map(part => ({
                guid: part['ns1:guid'][0],
                brand: part['ns1:brand'][0],
                partnumber: part['ns1:partnumber'][0],
                name: part['ns1:name'][0],
                stocks: part['ns1:stocks'][0]['ns1:stock'].map(stock => ({
                    id: stock['ns1:id'][0],
                    price: stock['ns1:price'][0],
                    count: parseInt(stock['ns1:count'][0], 10),
                    multiplicity: parseInt(stock['ns1:multiplicity'][0], 10),
                    type: parseInt(stock['ns1:type'][0], 10),
                    delivery: parseInt(stock['ns1:delivery'][0], 10),
                    extra: parseInt(stock['ns1:extra'][0], 10),
                    description: stock['ns1:description'][0],
                    deliveryStart: stock['ns1:deliveryStart'][0],
                    deliveryEnd: stock['ns1:deliveryEnd'][0]
                }))
            }));

            logger.info('Products by subcategory:', JSON.stringify(products, null, 2));

            return products;
        } else {
            const message = result['SOAP-ENV:Envelope']['SOAP-ENV:Body'][0]['ns1:GetSearchResponse'][0]['ns1:SearchResult'][0]['ns1:message'][0];
            logger.error('Ошибка Rossko API при поиске по подкатегории:', message);
            return null;
        }
    } catch (error) {
        logger.error('Ошибка получения данных от Rossko API при поиске по подкатегории:', error.response ? error.response.data : error.message);
        return null;
    }
}

function transformRosskoDataToOzonFormat(rosskoData) {
    if (!rosskoData || rosskoData.length === 0) {
        logger.error('Не найдены продукты в данных Rossko');
        return null;
    }

    const ozonData = {
        items: rosskoData.map(product => {
            const stock = product.stocks[0];
            return {
                attributes: [
                    {
                        attribute_complex_id: 0,
                        id: 85,
                        values: [
                            {
                                value: product.brand || "Нет бренда"
                            }
                        ]
                    },
                    {
                        attribute_complex_id: 0,
                        id: 7236,
                        values: [
                            {
                                value: product.partnumber
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
                                value: product.partnumber
                            }
                        ]
                    },
                    {
                        attribute_complex_id: 0,
                        id: 9048,
                        values: [
                            {
                                value: product.name
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
                images: [],
                images360: [],
                name: product.name,
                offer_id: product.guid,
                old_price: "1100",
                price: stock.price,
                primary_image: "",
                vat: "0.1",
                weight: 100,
                weight_unit: "g",
                width: 150
            };
        }),
    };

    return ozonData;
}

function chunkArray(array, size) {
    const result = [];
    for (let i = 0; i < array.length; i += size) {
        result.push(array.slice(i, i + size));
    }
    return result;
}

async function createOzonProducts(ozonData, limit) {
    if (!ozonData) {
        logger.error('Недействительные данные Ozon');
        return;
    }

    const products = ozonData.items.slice(0, limit);
    const chunks = chunkArray(products, 100);

    for (const chunk of chunks) {
        const chunkData = {
            items: chunk
        };

        try {
            const response = await axios.post(ozonCreateProductUrl, chunkData, {
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
}

async function main(query, productCount) {
    logger.info(`Received query: ${query}, productCount: ${productCount}`);

    const deliveryDetails = await getDeliveryDetails();
    if (deliveryDetails && deliveryDetails.deliveryIds.length > 0) {
        const deliveryId = deliveryDetails.deliveryIds[0];
        const addressId = deliveryDetails.addressId;
        const rosskoData = await getRosskoData(query, deliveryId, addressId, productCount);

        if (rosskoData) {
            const ozonData = transformRosskoDataToOzonFormat(rosskoData);
            if (ozonData) {
                await createOzonProducts(ozonData);
            }
        }
    }
}

const app = express();
const port = 3001;

app.use(cors());
app.use(bodyParser.json());

app.post('/api/create-products', async (req, res) => {
    const { query, productCount, subcategory, limit } = req.body;

    logger.info(`Received query: ${query}, productCount: ${productCount}, subcategory: ${subcategory}, limit: ${limit}`);

    try {
        const deliveryDetails = await getDeliveryDetails();
        if (deliveryDetails && deliveryDetails.deliveryIds.length > 0) {
            const deliveryId = deliveryDetails.deliveryIds[0];
            const addressId = deliveryDetails.addressId;
            let rosskoData;

            if (subcategory) {
                rosskoData = await getRosskoDataBySubcategory(subcategory, deliveryId, addressId, productCount);
            } else {
                rosskoData = await getRosskoData(query, deliveryId, addressId, productCount);
            }

            if (rosskoData) {
                const ozonData = transformRosskoDataToOzonFormat(rosskoData);
                if (ozonData) {
                    logger.info(`Sending data to Ozon: ${JSON.stringify(ozonData, null, 2)}`);
                    await createOzonProducts(ozonData, limit);
                    logger.info('Data successfully sent to Ozon');

                    const products = readProductsFromFile();
                    ozonData.items.slice(0, limit).forEach(newProduct => {
                        const existingProductIndex = products.findIndex(p => p.partnumber === newProduct.partnumber && p.brand === newProduct.brand);
                        if (existingProductIndex !== -1) {
                            if (existingProductIndex < products.length) {
                                newProduct.isDuplicate = true;
                            } else {
                                products[existingProductIndex].isDuplicate = true;
                            }
                        }
                    });
                    products.push(...ozonData.items.slice(0, limit));
                    writeProductsToFile(products);

                    res.status(200).send({ message: 'Products uploaded successfully!', products: ozonData.items.slice(0, limit) });
                } else {
                    logger.error('Ozon data transformation failed');
                    res.status(500).send({ message: 'Ozon data transformation failed' });
                }
            } else {
                logger.error('Rossko data fetch failed');
                res.status(500).send({ message: 'Rossko data fetch failed' });
            }
        } else {
            logger.error('Failed to get delivery details');
            res.status(500).send({ message: 'Failed to get delivery details' });
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
            product.partnumber.toLowerCase().includes(searchQuery.toLowerCase())
        );
    }
    res.status(200).send(products);
});

app.get('/api/categories', (req, res) => {
    res.status(200).send(categories);
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
