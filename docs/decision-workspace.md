本文件中的標的、交易所與拓撲示例是合成驗收資料，不描述私人持倉。

# 最小資料、截圖核對與保存契約

本文件是待實作設計，不代表現站已有此能力。基線為 Vue 3.5／Vite 8、Worker、D1、`/api/ledger` GET/PUT、整帳 CAS、2MB request；沒有 R2、站內模型或圖片上傳端點。

## 1. 保留實體與最小附加域

原 `schema_version:1`、`records`、`quotes`、`reviews`、`research`、`finance`、`imports`、`snapshots`、`company_favorites` 不改意義、不重建 ID、不複製成另一份帳本。增加一個可選 `journal` root，內部 `version:1`。為了新的理由、關聯與增量匯入，最小需要三個陣列：`positions`、`entries`、`intakes`。這是現有 JSON state 的附加域，不建新資料庫／event store／服務。

沒有 `journal` 的舊 state 在讀取時投影為空域；**讀取零寫入**。只有第一次真實保存使用者變更才寫入必要附加內容。所有新純函式、Worker、backup、history、各writer同步支援，不允許只改前端。

### position identity

| 欄位 | 契約 |
|---|---|
| id | 穩定、不含私人理由的ID；新部位UUID；舊快照的未持久化projection為`legacy-snapshot:<snapshot.id>` |
| snapshot_ids | 明確屬於此部位的觀測ID；一個snapshot最多屬於一個position；參照必須存在 |
| selected_snapshot_id | 有採用畫面時必須在snapshot_ids內；尚無快照的證據／決定容器允許null |
| instrument | 僅無快照容器必填：symbol、product、direction、exchange|null；有快照後與選定快照一致，不複製金額 |
| visibility | `current` / `not_current`，是列表狀態，不等於交易所平倉或已實現損益 |
| revision / created_at / updated_at | 狀態與關聯更正的版本與真實系統時間 |

原10快照各映射一個獨立position；第一次附上理由可保存該position的單筆metadata。未覆蓋的舊snapshot仍有deterministic fallback，不一次全量迁移。

symbol、product、exchange、direction優先由selected snapshot導出；無快照時由上述最小instrument提供。不能用symbol、槓桿、價格、數量當主鍵。新增觀測連到既有position須使用者明選且商品／標的／方向／交易所一致；未知值保留未知并要求人工確認是否同一部位。產品或已知交易所／方向不同的兩筆不能自動合併；完整更正需明示差異及歷史，不默默改身份。槓桿不同可是在同部位的變動，也可不同分倉，所以不得僅憑槓桿作合併或分拆結論。

`selected_snapshot_id`不是按imported_at自動最大。已知拍攝日期可提供建議，但仍核對；日期未知或互有矛盾，摘要名為「目前採用的畫面」，不得稱「最新」。舊畫面保持可讀。

原records產生的持倉是獨立 `ledger:<ticker>:<currency>` projection。其帳務仍按ticker+currency；不捏造exchange/account/position分攤。不把快照與record數值相加。若同標同時有兩種來源，詳頁分「持倉畫面」與「已記錄成交計算」，各標範圍；若不能判定重疊，不給混合總部位或資產總額，可分列「畫面部位N／成交帳本標的M」。

### journal entries

共同欄位：`id`、`kind`、`position_id`、`event_date`（YYYY-MM-DD|null）、`created_at`、`updated_at`、`revision`、`status`（active/withdrawn）、`source_refs`、`payload`。日期由使用者／來源提供，created_at由應用記錄；無日期不能由created_at補。

無快照只有成交證據／決定時，建立snapshot_ids=[]、selected_snapshot_id=null的最小instrument容器，visibility預設not_current；它出現在「所有紀錄」與詳頁，不計入目前持倉。不可製造空snapshot。之後明確加入持倉畫面才可轉入持倉列表。journal target亦可引用由真實records導出的`ledger:<ticker>:<currency>`；validator須核對該group確實存在，無需生成假snapshot或重建record。此group股數為零時仍可回顧，但不列為當前持倉。

| kind | payload最小內容 | 顯示與限制 |
|---|---|---|
| decision | action=`observe/hold/increase/reduce/exit/unspecified`；reason必填；expectation、risk、invalidation、horizon可空；authorship=`new_decision/retrospective/contemporaneous_source`；可選已登錄report引用 | 新決定不等於已執行買賣；舊快照補理由強制retrospective；contemporaneous_source須有真文字來源及時間，AI不可推測 |
| review | review_of明確指向snapshot或journal entry；outcome=`pending/supported/weakened/mixed`；lesson、next_action | 日期為回顧日期，可選今天但可改；原決定與後續回顧分開；不根據盈虧推outcome |
| execution_evidence | side；quantity/price/fees/currency可null；local_datetime/timezone可null；product/amount原語意；note | 保存買賣證據，永不由此直接replay；完整性與引擎可計算性是兩回事 |

來源參照限制為同owner的snapshot id＋source ordinal，或intake id＋source id。不接受可執行HTML或任意程式。decision文字不得由持倉數字、估值或盈虧自動生成。自述的歷史理由也用「事後補記」；除非有當時文字來源，不把填入舊event_date變成「當時已記錄」。

原records/reviews仍由原欄位呈現與保存；不複製進journal。對原record新增回顧沿舊reviews契約；對快照／新journal決定的回顧在journal。UI用read-only timeline adapter統一，不改原歷史。

原snapshot.observed_history在adapter中投影為穩定「成交證據」事件（key由snapshot ID＋原ordinal），不自動搬成entries或records。兩笔TESTTOKEN buy仍缺成交價等，不變為可重播成交。

### intakes（新增批次收據）

共同欄位：`id`、`content_hash`、`package_digest`、`source_manifest`、`candidate_receipts`、`created_at`、`status`（applied/withdrawn）。每個candidate receipt含包內candidate ID、選擇（新增／連結已知部位／略過重複）、applied refs、保存後內容摘要hash、最小inverse metadata；被略過者保留去重理由與existing ref，不刪其證據來歷。

inverse metadata區分created和updated：對更新既有position記錄本批前snapshot_ids、selected_snapshot_id及有變動時的visibility；對來源增補只記新增source集合；對新position標其為本批建立。undo還原這些局部欄位，不能把既有position整個not_current。新增觀測如需移出關聯，receipt status保留withdrawn引用作tombstone，projection不再把它當未關聯legacy新部位顯示；原證據仍可在本批次及歷史中讀取。同批自建引用不算後續依賴，其他批次/保存後變更才是阻擋條件。

source_manifest只存名稱、可核實的SHA、可選Library id、整理方法（conversation_ai/manual）、整理時間若已知，以及原圖是否只在本機預覽。**不存base64、圖像bytes、公開下載URL或模型prompt全文**。candidate核對時間是使用者核對事件，不代表來源數據正確／行情即時。

intake不複製全部state；不保存每版完整候選payload以免迅速撞2MB。完整旧state的保全沿D1 history。撤回依applied refs及post-save digest檢查，詳見下文。

### 型別与大小

- journal entry/position最多各10000，intake最多1000（產品保護上限）；文字沿既有reason5000、horizon200、note3000等量級；最終以2MB UTF-8整帳request更嚴的上限為准。
- ID格式沿既有安全ID規則，唯一性、引用存在、禁止循環review引用、不可跨position引用未關聯來源。所有數字finite且在現有上界；不同商品／欄位的合理正負沿現有validator，空值不轉0。
- source SHA必須是真正原檔hash；已知用64hex，未知用null，不填假的64個0。現有snapshot.sources對SHA和Library ID嚴格；最小相容擴充允許這兩欄null，舊字串逐值保留。未知SHA來源不可享有檔案去重或「原檔已核對」狀態。
- server拒絕未知root／payload欄位、無效enum、錯誤引用、偽data URL。詳細錯誤回傳path供欄位定位，不能只回一串無法導航的總錯誤。

## 2. 新增候選包（與備份格式分離）

新format：`investment-capture-candidates-v1`。它描述候選，**不是ledger state、不是restore、不是模型執行指令**。

| 欄位 | 內容 |
|---|---|
| format | 固定format名稱 |
| sources | id/name/sha256|null/library_file_id|null；可選來源中可見的日期與時間，不含bytes |
| candidates | 每筆id、kind（snapshot/execution_evidence）、source_refs、extracted_fields；可選verbatim_text或欄位定位短文，非推論理由 |
| warnings | 可選可讀缺口清單；網站重新驗證，不信任這個清單宣稱安全 |

AI整理schema由網站／repo提供簡明格式说明，可複製回主對話；整理者將原圖中能確定的內容填值，缺項null，拆同圖多部位、保留跨圖來源。原圖hash由實際本機讀檔工具產生或網站本地計算，模型不得猜。候選包不含expected_owner_scope、伺服器revision或寫入授權。

專用候選檔建議上限1MB、每次≤20張來源／≤100候選；圖片本地預覽每張≤10MB、總計≤50MB，只接受PNG/JPEG/WebP，MIME及解碼都驗，不接受SVG/HTML。這些是本產品待實作限制，不是已驗證的模型服務限制。超額給拆批提示，已有合法候選保留。

流程：

1. 使用者在既有主對話貼圖，AI在對話工具能力內整理。網站顯示這個真實邊界；沒有API就不顯示假的上傳/辨識progress。
2. 網站選擇候選檔或貼候選文字，`parseCandidatePackage`驗證，生成一次性的穩定local intake ID；重新核對不更換ID。
3. 可選本機貼／選原圖，瀏覽器計hash與候選來源配對；不匹配時不自動附到錯圖。尚無圖就顯示「原圖未在此分頁開啟」，仍可核對來源metadata和數值。
4. 每候選選保留類型、修正值／保留未知、選新部位或更新既有部位、判定重複；使用者勾選本次要保存的項目。不能讓未核對候選混入已保存列表。
5. 預覽「新增X個部位／追加Y張畫面／保留Z筆成交證據／略過D個重複」。兩個不同價格／槓桿或方向的同symbol不自動合併。
6. `buildIntakeDelta`從當前完整state增量構造候選（保留所有原切片），驗證、固定content hash和base context。保存一次整帳CAS。
7. 成功顯示具體筆數，進相應標的詳頁或回持倉清單；可「查看本次新增」與範圍限定「撤回本次新增」。

對話AI不能解析或輸出格式錯誤：網站指出錯誤字段與可修復方式，提供回到對話重新整理或手動核對；已選圖仍保留於目前分頁。不得讓使用者因一筆未知日期被迫造數。手動也沿同一候選型別／核對／保存路徑；只有原引擎確實支援且必要欄位齊全的成交才走records。

原records currency為3字母；USDT永續不可填USD偽裝。v1手動「完整成交」可沿已支援股票／現貨計算範圍；unsupported product或currency只存execution_evidence並顯示「僅留存，尚未納入績效」。不在本UI重做中改寫衍生品會計。

原「完整備份」上傳到候選入口時拒絕並引導資料管理的還原預覽。不能以先組新state再讓使用者按整帳還原當作新增UX。

## 3. 真AI能力與後端邊界

本次无需新增API endpoint、R2或secret：本地圖片預覽＋對話AI生成候選＋既有ledger PUT即可完成可用的人工核對接力。不得呼叫未登錄的模型proxy、借用使用者登入token作AI key，或把Library file id當網站可公開fetch的URL。

若日後已有核實且授權的站內視覺模型能力，才替換「取得整理結果」那一步；仍輸出同樣候選schema。必要前提是：owner-auth server端调用、授權圖片傳送／保留政策、成本上限、格式／大小、timeout/retry/cancel、rate limit、request id去重、model provenance。不能將這些前提記為本次已完成，也不自行加新provider或要求使用者提供key。

當前UI的source drawer只有metadata；無本站圖片就文字「原圖未保存於本站，可重新選擇原圖比對」。hash相符只证明是同檔，不代表數字正確。無原圖瀏覽能力時不出現空白thumbnail、假原圖連結或共享私有資產。

## 4. 重複與來源

| 層次 | 判斷與處理 |
|---|---|
| 相同intake ID＋同content hash已存在 | 結果為already_applied；讀回並顯示原批次，0新增 |
| 同intake ID但content hash不同 | 衝突，要求重新核對／另建明确新批次，不能overwrite receipt |
| 相同原圖SHA | 提示已處理的來源；仍逐候選檢查，不能整張一刀略過可能新增內容 |
| 同package_digest＋包內候選ID，且內容亦相同／已核實的相同來源候選鍵 | 預設略過，展示已保存ref；不得每次retry重生ID |
| 不同圖但疑似重疊 | 只提出候選比對，展示標的、商品、方向、交易所、原值及來源；使用者選同一觀測／不同部位／待確認 |
| 同symbol、相似數字 | 不是去重充分條件；預設獨立待核對 |

TESTD既有跨圖尾段：保持1個快照、2個來源及差異說明。疑似同一觀測的新來源可在一次CAS中附加source metadata而不新增部位；保留原來源與原值，差異需明確核對。這是使用者明示合併來源，不是自動丟棄。

候選ID只在包內唯一；不同包的`candidate-1`不可互相去重。package_digest由網站對原始候選包的規範化內容計算，content_hash則綁本次核對後delta與選擇；兩者不同用途。跨包未知SHA或來源鍵不確定只能提示人工比對，不能預設略過。

同一已知部位的新日期快照是新觀測，不是重複，仍保留舊圖與數值。unknown日期時hash與來源不能證明市場先後。

## 5. 保存狀態機、CAS與idempotency

`idle → editing → validating → ready → saving → saved`；分支`invalid / failed / conflict / result_unknown / auth_lost`。表單draft與server state分開。

- `openEdit/preparePreview`固定base scope、whole-state revision、target revision/digest及輸入hash。不得在focus reload時替換base。若同scope讀到新revision，僅標記stale並保留draft。
- PUT仍用`expected_revision`、`expected_owner_scope`。保存期間禁重送；任何接回異步結果都檢查load sequence／scope／base request。異步返回後身份變了則丟棄結果。
- 409：顯示衝突，保留同owner draft；「載入最新後重新核對」比對現值／草稿、重新生成增量，使用者再次保存。禁止自動last-write-wins。
- unrelated favorite變更也會造成整帳revision變；重新核對後以最新完整state加delta，不把收藏復原成舊狀態。
- 網路timeout或stream中斷：顯示「保存結果待確認」；GET檢查intake ID/digest或entity ID/content。已存在就顯示已保存；不存在且scope相同才重新核對後重送；GET失敗不宣稱成功也不盲目重送。intake ID在整個重試期間固定。
- 401/identity_changed：清除資料投影、草稿、候選包、圖片object URL／記憶體和歷史。先清再顯示登入／重載；不保留到新身份。
- input異常／422：定位fields，保持草稿；500／offline：保留本分頁草稿與可重試狀態，但不承諾跨刷新保存。
- v1不預設持久化私人draft到localStorage。可在dirty navigation/beforeunload提示；可選手動下載候選草稿（metadata與欄位，無圖）。產品文案只承諾當前分頁保留，回訪需重新匯入。

**旧client保護**：現有full-state PUT不能允許已存在journal被舊cached writer意外省略。server在既有state含journal時拒絕缺journal的普通save（client_upgrade_required），引導刷新；所有新版writer往返保留未知但已支援域。完整restore是另一個明確預覽動作，若選的是舊備份不含journal，必須醒目列出將移除journal數量並要求完整還原確認；不能繞普通save guard。實作者可以保留原endpoint、增加明確restore intent與base-bound確認摘要；server仍做scope/CAS及差異核對。不可用自動补空journal修過舊寫入器。

## 6. 撤回、復原與修改歷史

- 真交易沿原active/withdrawn與全帳重播防超賣；恢復也重新驗證。
- journal entry撤回是軟狀態改變；timeline默认隱去、更多可顯示已撤回。相關回顧不被連帶刪除，原文仍可看。
- 部位「不再列為目前持倉」只改visibility；用詞不可「已賣出」或「平倉成功」。要記錄實際賣出，走新增證據／完整成交路徑。
- 「撤回本次新增」只對intake.applied_refs：檢查当前内容digest仍為本批新增後版本、无其他source/decision/review/position link依賴。允許移出当前清單或撤回新增；保留intake和原始歷史。任一依賴不滿足時整批不局部偷偷執行，列出阻擋項。
- v1撤回不刪原snapshot證據：新建position標not_current、entry標withdrawn；更新既有position則以inverse metadata恢復本批前的選取和關聯，新觀測在intake receipt留下withdrawn tombstone，projection排除它的legacy fallback。既有snapshot追加來源的undo只移除本批新來源關聯，且須未被後續修改；不能回滚旧來源。復原前仍重新驗證目前依賴、同一snapshot唯一歸屬和CAS。
- toast「復原」是新的CAS操作，基於當前完整state；不能restore某個歷史全帳。提供資料管理「本次新增」作永久可找入口，不限使用者5秒內點toast。
- 修改理由／回顧顯示最後修改時間；D1保留修改前state。history是保存史，不是市場時間線。最近100筆只是API列出metadata上限，不声稱只有100版保留。

## 7. 遷移、保全與隱私

首次開新UI無寫入、無自動exchange補值、無生成records。對10 snapshots投影後IDs/fields/sources/observed_history都相等；2不完整TESTTOKEN證據仍非records；TESTD來源仍2份；未知date/quantity/fees不變。

每種writer（收藏、research、CSV、finance、ledger、journal）都用讀回完整state再改其切片、base-bound CAS；核對變更差異只在預期切片。完整backup序列化新域，舊backup可預覽兼容；歷史舊版不需回填journal。

正式資料只留owner D1／使用者指定的Git外位置。來源截圖、private transcript、備份、QA真實payload、Library ID、cookie、token、secret不得入GitHub或dist；設計示意以虛構值／省略號。原研究可發布範圍不因UI重做擴大；paid全文不補上傳。

資料管理明列：D1私人帳本備份包含records/reviews/research/finance/imports/snapshots/favorites/journal；X來源的既有瀏覽器IndexedDB另行匯出。不能混稱全站所有私人資料已一鍵備份。
