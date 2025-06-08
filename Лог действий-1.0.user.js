// ==UserScript==
// @name         Лог действий
// @namespace    http://tampermonkey.net/
// @version      1.0
// @author       Невезение
// @match        *://patron.kinwoods.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// ==/UserScript==

(function() {
    'use strict';

    // 1. Создаем лог действий
    function createActionLog() {
        const gameContainer = document.querySelector('.game-container.svelte-15im41r');
        if (!gameContainer) return null;

        const logContainer = document.createElement('div');
        logContainer.style.margin = '10px 0';
        logContainer.style.padding = '10px';
        logContainer.style.color = '#1e1e1e';
        logContainer.style.borderTop = '1px solid #ccc';

        const headerRow = document.createElement('div');
        headerRow.style.display = 'flex';
        headerRow.style.justifyContent = 'space-between';
        headerRow.style.alignItems = 'center';
        headerRow.style.marginBottom = '15px';

        const logTitle = document.createElement('div');
        logTitle.textContent = 'Лог действий игрока:';
        logTitle.style.fontFamily = 'Roboto, monospace';
        logTitle.style.fontSize = '16px';
        logTitle.style.marginRight = '10px';

        const resetButton = document.createElement('button');
        resetButton.textContent = 'Сбросить лог';
        resetButton.style.fontFamily = 'Roboto, monospace';
        resetButton.style.fontSize = '12px';
        resetButton.style.padding = '4px 12px';
        resetButton.style.backgroundColor = '#957b77';
        resetButton.style.color = '#ffffff';
        resetButton.style.border = '1px solid #ccc';
        resetButton.style.borderRadius = '4px';
        resetButton.style.cursor = 'pointer';
        resetButton.style.transition = 'all 0.2s';

        resetButton.addEventListener('mouseover', function() {
            this.style.backgroundColor = '#a58b87';
            this.style.boxShadow = '0 0 5px rgba(0,0,0,0.2)';
        });
        resetButton.addEventListener('mouseout', function() {
            this.style.backgroundColor = '#957b77';
            this.style.boxShadow = 'none';
        });

        resetButton.addEventListener('click', function() {
            if (confirm('Вы уверены, что хотите сбросить лог действий?')) {
                GM_setValue('actionLog', '');
                document.getElementById('playerActionLog').textContent = '';
            }
        });

        headerRow.appendChild(logTitle);
        headerRow.appendChild(resetButton);

        const logContent = document.createElement('div');
        logContent.id = 'playerActionLog';
        logContent.style.fontFamily = 'Roboto, monospace';
        logContent.style.fontSize = '14px';
        logContent.style.wordBreak = 'break-word';
        logContent.style.marginTop = '5px';

        const savedLog = GM_getValue('actionLog', '');
        logContent.textContent = savedLog;

        logContainer.appendChild(headerRow);
        logContainer.appendChild(logContent);
        gameContainer.appendChild(logContainer);

        return logContent;
    }

    // 2. Функция для добавления записи в лог
    function addToActionLog(message) {
        const logElement = document.getElementById('playerActionLog');
        if (!logElement) return;

        let newText;
        if (logElement.textContent === '') {
            newText = message + '.';
        } else {
            newText = logElement.textContent + ' ' + message + '.';
        }

        logElement.textContent = newText;
        GM_setValue('actionLog', newText);
    }

    // 3. Функция для получения имени предмета из элемента
    function getItemName(element) {
        const tooltip = element.querySelector('.cell-tooltip p');
        return tooltip ? tooltip.textContent.trim() : null;
    }

    // 4. Переменные для отслеживания перемещения предметов
    let lastGroundItems = new Map();
    let lastInventoryItems = new Map();
    let lastBagItems = new Map();
    let lastUpdateTime = 0;
    let checkInterval = 100;

    // 5. Переменные для отслеживания обычных действий
    let lastLoggedAction = null;
    let isActionActive = false;
    let inCombat = false;
    let combatLogged = false;
    let cancelButtonObserver = null;
    let interactionButtonObserver = null;
    let eatButtonObserver = null;

    // 6. Функция для сканирования текущих предметов
    function scanItems() {
        const currentGroundItems = new Map();
        const currentInventoryItems = new Map();
        const currentBagItems = new Map();

        // Сканируем предметы на земле
        document.querySelectorAll('.cell-items .slot-item').forEach((slot, index) => {
            const name = getItemName(slot);
            if (name) currentGroundItems.set(index, name);
        });

        // Сканируем предметы в инвентаре
        document.querySelectorAll('.my-items .slot-item').forEach((slot, index) => {
            const name = getItemName(slot);
            if (name) currentInventoryItems.set(index, name);
        });

        // Сканируем предметы в сумке/кульке
        document.querySelectorAll('.bag-items .slot-item').forEach((slot, index) => {
            const name = getItemName(slot);
            if (name) currentBagItems.set(index, name);
        });

        return { currentGroundItems, currentInventoryItems, currentBagItems };
    }

    // 7. Улучшенная функция для определения перемещения предметов
    function determineItemMovement(oldItems, newItems, locationType) {
        const movedItems = [];

        // Проверяем исчезнувшие предметы
        for (const [index, name] of oldItems) {
            if (!newItems.has(index)) {
                movedItems.push({
                    action: 'взял',
                    name: name,
                    location: locationType,
                    index: index
                });
            }
        }

        // Проверяем появившиеся предметы
        for (const [index, name] of newItems) {
            if (!oldItems.has(index)) {
                movedItems.push({
                    action: 'положил',
                    name: name,
                    location: locationType,
                    index: index
                });
            }
        }

        return movedItems;
    }

    // 8. Улучшенная функция для проверки перемещения предметов
    function checkItemMovement() {
        const now = Date.now();
        if (now - lastUpdateTime < checkInterval) return;
        lastUpdateTime = now;

        const { currentGroundItems, currentInventoryItems, currentBagItems } = scanItems();

        // Определяем все изменения
        const groundChanges = determineItemMovement(lastGroundItems, currentGroundItems, 'земля');
        const inventoryChanges = determineItemMovement(lastInventoryItems, currentInventoryItems, 'инвентарь');
        const bagChanges = determineItemMovement(lastBagItems, currentBagItems, 'сумка');

        // Анализируем перемещения между землей и инвентарем
        if (groundChanges.length > 0 && inventoryChanges.length > 0) {
            // Предмет исчез с земли и появился в инвентаре
            const takenFromGround = groundChanges.find(c => c.action === 'взял');
            const addedToInventory = inventoryChanges.find(c => c.action === 'положил');

            if (takenFromGround && addedToInventory && takenFromGround.name === addedToInventory.name) {
                addToActionLog(`Подобрал ${takenFromGround.name}`);
                groundChanges.splice(groundChanges.indexOf(takenFromGround), 1);
                inventoryChanges.splice(inventoryChanges.indexOf(addedToInventory), 1);
            }

            // Предмет исчез из инвентаря и появился на земле
            const takenFromInventory = inventoryChanges.find(c => c.action === 'взял');
            const addedToGround = groundChanges.find(c => c.action === 'положил');

            if (takenFromInventory && addedToGround && takenFromInventory.name === addedToGround.name) {
                addToActionLog(`Выложил ${takenFromInventory.name} на землю`);
                groundChanges.splice(groundChanges.indexOf(addedToGround), 1);
                inventoryChanges.splice(inventoryChanges.indexOf(takenFromInventory), 1);
            }
        }

        // Анализируем перемещения между инвентарем и сумкой
        if (inventoryChanges.length > 0 && bagChanges.length > 0) {
            // Предмет исчез из инвентаря и появился в сумке
            const takenFromInventory = inventoryChanges.find(c => c.action === 'взял');
            const addedToBag = bagChanges.find(c => c.action === 'положил');

            if (takenFromInventory && addedToBag && takenFromInventory.name === addedToBag.name) {
                addToActionLog(`Положил ${takenFromInventory.name} в сумку`);
                inventoryChanges.splice(inventoryChanges.indexOf(takenFromInventory), 1);
                bagChanges.splice(bagChanges.indexOf(addedToBag), 1);
            }

            // Предмет исчез из сумки и появился в инвентаре
            const takenFromBag = bagChanges.find(c => c.action === 'взял');
            const addedToInventory = inventoryChanges.find(c => c.action === 'положил');

            if (takenFromBag && addedToInventory && takenFromBag.name === addedToInventory.name) {
                addToActionLog(`Достал ${takenFromBag.name} из сумки`);
                bagChanges.splice(bagChanges.indexOf(takenFromBag), 1);
                inventoryChanges.splice(inventoryChanges.indexOf(addedToInventory), 1);
            }
        }

        // Анализируем перемещения между землей и сумкой
        if (groundChanges.length > 0 && bagChanges.length > 0) {
            // Предмет исчез с земли и появился в сумке
            const takenFromGround = groundChanges.find(c => c.action === 'взял');
            const addedToBag = bagChanges.find(c => c.action === 'положил');

            if (takenFromGround && addedToBag && takenFromGround.name === addedToBag.name) {
                addToActionLog(`Подобрал ${takenFromGround.name} в сумку`);
                groundChanges.splice(groundChanges.indexOf(takenFromGround), 1);
                bagChanges.splice(bagChanges.indexOf(addedToBag), 1);
            }

            // Предмет исчез из сумки и появился на земле
            const takenFromBag = bagChanges.find(c => c.action === 'взял');
            const addedToGround = groundChanges.find(c => c.action === 'положил');

            if (takenFromBag && addedToGround && takenFromBag.name === addedToGround.name) {
                addToActionLog(`Выложил ${takenFromBag.name} из сумки на землю`);
                bagChanges.splice(bagChanges.indexOf(takenFromBag), 1);
                groundChanges.splice(groundChanges.indexOf(addedToGround), 1);
            }
        }

        // Обновляем последние состояния
        lastGroundItems = new Map(currentGroundItems);
        lastInventoryItems = new Map(currentInventoryItems);
        lastBagItems = new Map(currentBagItems);
    }
    // 9. Функция определения действия игрока (обычные действия)
    function parsePlayerAction() {
        // Проверка обычных действий (исключая поедание)
        const timerElement = document.querySelector('div.panel.svelte-1t5p5a7 > p.svelte-1t5p5a7');
        if (timerElement) {
            const timerText = timerElement.textContent.trim();
            if (timerText.includes('осталось') && timerText.includes('сек')) {
                const actionText = timerText.split('осталось')[0].trim();

                if (actionText.includes('Идти')) {
                    const location = document.querySelector('p#loc-name.svelte-1rta3dd')?.textContent?.trim() || 'неизвестное место';
                    return `Пошёл в ${location}`;
                } else if (actionText.includes('Обыскивать труп')) {
                    return 'Обыскал труп';
                } else if (actionText.includes('Искать следы')) {
                    return 'Искал следы';
                } else if (actionText.includes('Изучать след')) {
                    return 'Изучил след';
                } else if (actionText.includes('Искать дичь')) {
                    return 'Искал дичь';
                } else if (actionText.includes('Пить')) {
                    return 'Попил';
                } else if (actionText.includes('Нырять')) {
                    const location = document.querySelector('p#loc-name.svelte-1rta3dd')?.textContent?.trim() || 'неизвестное место';
                    return `Нырнул в ${location}`;
                } else if (actionText.includes('Всплывать')) {
                    const location = document.querySelector('p#loc-name.svelte-1rta3dd')?.textContent?.trim() || 'неизвестное место';
                    return `Всплыл в ${location}`;
                }
            }
        }

        return null;
    }


    // 10. Функция проверки боя
    function checkCombatStatus() {
        const combatElement = document.querySelector('p.turn-text.svelte-1yiowxi');
        const isInCombat = combatElement && combatElement.textContent.includes('[Сейчас ходит');

        if (isInCombat && !inCombat) {
            // Начало боя
            inCombat = true;
            combatLogged = false;
            addToActionLog('Вошёл в бой');
            combatLogged = true;
        } else if (!isInCombat && inCombat) {
            // Конец боя
            inCombat = false;
            combatLogged = false;
        }
    }

    // 11. Функция проверки обычных действий игрока
    function checkPlayerAction() {
        checkCombatStatus();

        const currentAction = parsePlayerAction();

        if (currentAction && !isActionActive) {
            addToActionLog(currentAction);
            lastLoggedAction = currentAction;
            isActionActive = true;
        } else if (!currentAction) {
            isActionActive = false;
        }
    }

    // 12. Функция для наблюдения за кнопкой отмены
    function setupCancelButtonObserver() {
        if (cancelButtonObserver) return;

        const targetNode = document.body;
        const config = { childList: true, subtree: true };

        cancelButtonObserver = new MutationObserver(function(mutations) {
            mutations.forEach(function(mutation) {
                if (!mutation.addedNodes) return;

                const cancelButtons = document.querySelectorAll('.timer-cancel.svelte-1t5p5a7');
                cancelButtons.forEach(button => {
                    if (!button.hasAttribute('data-log-listener')) {
                        button.setAttribute('data-log-listener', 'true');
                        button.addEventListener('click', function() {
                            addToActionLog('Отменил действие');
                        });
                    }
                });
            });
        });

        cancelButtonObserver.observe(targetNode, config);
    }

    // 13. Функция для наблюдения за кнопкой взаимодействия
    function setupInteractionButtonObserver() {
        if (interactionButtonObserver) return;

        const targetNode = document.body;
        const config = { childList: true, subtree: true };

        interactionButtonObserver = new MutationObserver(function(mutations) {
            mutations.forEach(function(mutation) {
                if (!mutation.addedNodes) return;

                const interactionButton = document.querySelector('button.action.svelte-5ea9xh img[src="pics/actions/12.png"]');
                if (interactionButton && !interactionButton.closest('button').hasAttribute('data-log-listener')) {
                    const button = interactionButton.closest('button');
                    button.setAttribute('data-log-listener', 'true');
                    button.addEventListener('click', function() {
                        addToActionLog('Повзаимодействовал со Странником');
                    });
                }
            });
        });

        interactionButtonObserver.observe(targetNode, config);
    }

    // 14. Функция для наблюдения за кнопкой "Съесть"
    function setupEatButtonObserver() {
        if (eatButtonObserver) return;

        const targetNode = document.body;
        const config = { childList: true, subtree: true };
        let healthBefore = 0;

        // Функция для получения текущего здоровья
        function getCurrentHealth() {
            const healthElement = document.querySelector('.bar-number.svelte-1dlaans');
            if (!healthElement) return 0;

            const healthText = healthElement.textContent.split('<!---->')[0].trim();
            return parseInt(healthText.split('/')[0].trim()) || 0;
        }

        eatButtonObserver = new MutationObserver(function(mutations) {
            mutations.forEach(function(mutation) {
                if (!mutation.addedNodes) return;

                const eatButtons = document.querySelectorAll('.eatButton.svelte-bphnd8');
                eatButtons.forEach(button => {
                    if (!button.hasAttribute('data-log-listener')) {
                        button.setAttribute('data-log-listener', 'true');

                        button.addEventListener('click', function() {
                            // 1. Получаем выделенный предмет
                            const allSelected = document.querySelectorAll('.my-items .slot-item.selected');
                            const edibleItems = Array.from(allSelected).filter(item => {
                                const itemName = getItemName(item);
                                return itemName && !itemName.match(/Сумка|Кулёк|Свёрток|Контейнер/i);
                            });
                            const lastSelected = edibleItems[edibleItems.length - 1];
                            const itemName = lastSelected ? getItemName(lastSelected) : null;

                            // 2. Запоминаем здоровье до еды
                            healthBefore = getCurrentHealth();

                            // 3. Проверяем здоровье после небольшой задержки
                            setTimeout(() => {
                                const healthAfter = getCurrentHealth();
                                const healthGain = healthAfter - healthBefore;

                                // 4. Записываем в лог
                                if (itemName) {
                                    addToActionLog(`Съел ${itemName}`);
                                    if (healthGain > 0) {
                                        addToActionLog(`Исцелился на ${healthGain} единиц здоровья`);
                                    }
                                } else {
                                    addToActionLog('Поел (предмет не выбран)');
                                    if (healthGain > 0) {
                                        addToActionLog(`Исцелился на ${healthGain} единиц здоровья`);
                                    }
                                }
                            }, 300); // Оптимальная задержка для обновления UI
                        });
                    }
                });
            });
        });

        eatButtonObserver.observe(targetNode, config);
    }

    // 15. Инициализация
    const waitForContainer = setInterval(function() {
        if (document.querySelector('.game-container.svelte-15im41r')) {
            clearInterval(waitForContainer);
            createActionLog();

            // Начальное сканирование предметов
            const { currentGroundItems, currentInventoryItems, currentBagItems } = scanItems();
            lastGroundItems = new Map(currentGroundItems);
            lastInventoryItems = new Map(currentInventoryItems);
            lastBagItems = new Map(currentBagItems);

            // Настройка наблюдателей
            setupCancelButtonObserver();
            setupInteractionButtonObserver();
            setupEatButtonObserver();

            // Запускаем проверку перемещения предметов и обычных действий
            setInterval(checkItemMovement, checkInterval);
            setInterval(checkPlayerAction, 300);
        }
    }, 100);
})();
