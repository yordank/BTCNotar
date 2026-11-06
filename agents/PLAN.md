# План

Developer взима първата задача с `- [ ]`.
Reviewer я маркира `- [x]`, когато я одобри.
Една задача = един ред. Пиши задачите ясно и малки.

- [x] Добави unit тестове за MerkleTree в packages/btcnotar/test (корен, proof, verify, 1 и много хеша)
- [x] Добави unit тестове за MemoryStore и FileStore в packages/btcnotar/test
- [x] Proof файл: waitForProof, saveProof, verifyProofFile + CLI wait/save/verify-file (версия 0.3.0)

## За Jordan (ръчно — агентите не пипат тези редове)

- (Jordan) Публикувай npm 0.4.0: `git pull`, `cd packages\btcnotar`, `npm whoami` (трябва jordan21, иначе `npm login`), `npm publish`
- (Jordan) Публикувай Python 0.1.0 в PyPI: акаунт в pypi.org, после `cd packages\python`, `pip install build twine`, `python -m build`, `twine upload dist/*`
- (Jordan) След PyPI: смени текста "Ideas: versions for Python..." на сайта, че Python вече е наличен (`pip install btcnotar`)
- (Jordan) Провери, че Railway е направил deploy на новия сайт (бутон "Download proof" и "Verify a proof file")
- (Jordan) Настрой домейна api.btcnotar.com в Railway, после смени DEFAULT_SERVER_URL (виж по-долу)

## Следващи задачи

### Бъгове в BTCNotar (packages/btcnotar/src)
- [x] store.js: saveBatch и findBatchByHash да ползват hash с малки букви (сега hash с главни букви не се намира) + тест
- [x] notary.js: addHash да приема само 64 hex знака (като клиента) + тест
- [x] notary.js: addHash да не добавя hash, който вече е anchored (да върне съществуващия proof) + тест
- [x] notary.js: в _settle първо записвай batch със status "signed" и rawHex, после broadcast; при рестарт изпрати отново неизпратените + тест
- [x] notary.js: избирай UTXO, който стига за fee (не само utxos[0]); ясна грешка ако няма + тест
- [x] store.js: FileStore да пише атомарно (временен файл + rename) + тест
- [x] bitcoin.js: включи RBF (sequence 0xfffffffd), за да може fee да се вдигне + тест

### По-лек пакет
- [x] Замени axios с вградения fetch (Node 18+); махни axios от dependencies; тестовете да минават
- [x] Махни dotenv от библиотеката; да остане само в bin/cli.js (или да се зарежда само ако има .env)
- [x] Нов вход "btcnotar/client" (client + verify + prooffile) без bitcoinjs-lib; добави го в package.json exports + тест

### По-лесно ползване
- [x] Добави TypeScript типове index.d.ts за всички exports; добави "types" в package.json
- [x] Добави sha256File(path) със stream (за големи файлове) + export + тест
- [x] Добави client.submitMany(hashes) (и route в examples/webapp/server.js) + тест
- (чака Jordan: първо домейн api.btcnotar.com в Railway, после стане задача) DEFAULT_SERVER_URL да стане https://api.btcnotar.com

### Уеб приложение (examples/webapp)
- [x] Бутон "Download proof" на сайта: сваля <hash>.btcnotar.json във формата на prooffile.js
- [x] Страница "Verify proof file": качваш proof файл + документ, проверка в браузъра през mempool.space

### Спецификация и други езици
- [x] SPEC.md: формат BTN1, Merkle правила, proof файл, API на сървъра
- [x] test-vectors.json: примерни hash-ове, root, proof-ове (за проверка на версиите на други езици) + тест, че JS ги минава
- [x] Python версия (pip): client + verifyProofFile, минава test-vectors.json
- [ ] Go, Rust, .NET (NuGet) версии — една задача за всеки език, след Python

### Тестове и CI
- [x] Тестове за verify.js (всички reason стойности)
- [x] Тестове за bitcoin.js: encode/decode OP_RETURN, extractOpReturnData, createOpReturnTx (dust, малко пари)
- [x] Тестове за bin/cli.js (submit, check, save, verify-file с фалшив сървър)
- [x] GitHub Actions: npm test при всеки push и PR (Node 18, 20, 22)
