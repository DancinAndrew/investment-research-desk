本文件中的標的、交易所與拓撲示例是合成驗收資料，不描述私人持倉。

# 技術與互動設計決定

本文件是OpenSpec設計索引；完整視覺及頁面契約在 `docs/UI-DESIGN-v4.md`，資料型別與保存狀態機在 `docs/decision-workspace.md`。三者一併交付，不能只讀tasks就開始造UI。

## 1. 沿既有架構

維持Vue/Vite、Worker/D1、query路由、原owner-only部署。原GET/PUT ledger承載私人JSON；沒有站內AI endpoint。圖像預覽留分頁記憶體，對話整理結果用專用候選format，save是增量組state後一次CAS。

元件分工建議（名稱可依repo慣例微調，責任不能混回大檔）：

| 責任 | 建議模組 | 复用 |
|---|---|---|
| App導航與URL恢復 | App.vue +小型route helper | 原navigate/pop、舊query相容 |
| 列表／篩選 | HoldingsWorkspace / HoldingsList | snapshots + replayLedger read-only projection |
| 同頁詳情 | PositionDetail / PositionTimeline / DecisionDetail | 原reason/reviews/report link呈現 |
| 新增與候選核對 | RecordComposer / CaptureReview | 原CSV parser，獨立screenshot candidate parser |
| 短編輯 | DecisionEditor / ReviewEditor | 可及性dialog、原表單型別與labels |
| 資料管理 | DataManagement | 原backup/history/restore、CSV batch |
| domain純函式 | holdings-view、journal-core、capture-intake | 原snapshot-core、ledger-core、csv-ledger等 |
| 共享保存上下文 | private-state.js優先整合 | 固定scope/revision、abort/sequence、所有writer保全 |

不把這些拆分當作新框架／state library的理由。若既有結構可保留而符合責任，無需逐個照名建檔。

## 2. 明確路由

`workspace=ledger`為持倉；`view=position&position=<stable-id>`為詳頁；`event=<id>`選時間線項；`view=add&method=capture|manual|csv`新增。query僅放穩定ID與篩選，不放理由／金額／圖像來源。readonly時間線選擇用replaceState以免每次點選製造多個返回階層；進／出詳頁與composer用pushState。返回恢復原篩選和scroll。

保留 `workspace=review&record=<id>` 對原交易回顧的深連結；不存在的ID給「找不到這筆紀錄」＋回列表，不空白崩潰。報告的ticker/report帶入composer context並明確讓使用者選新增方式，不自動生成BUY。保留公司URL全部篩選與report version行為。

## 3. 資料投影優先

10舊snapshot各自投影為獨立position，不讀取就寫入。新增journal只在使用者真保存時存在。records平均成本計算依舊ticker+currency，不混snapshot或USDT永續。CompanyLedgerSummary和主持倉共用投影，避免一處顯示有持倉、一處說尚無。

timestamp分四種：畫面日期captured_date、畫面時間screen_time/local_datetime、實際decision/review event_date、系統created/imported/updated。未知值不互相替代。完全未知日期放獨立區；沒有時區的觀測只可保留原本地字面日期和「時區未確認」。

## 4. 理由與回顧

原record reason/reviews維持原持久化欄位。snapshot可用journal補記理由和review；補記必須可辨識，不冒充當時理由。非交易決定action不產生record。AI候選不推理用戶買賣理由。

## 5. 從截圖新增的取捨

沒有新增服務時仍可完成：既有主對話AI→專用候選包→站內逐筆核對→保存。圖片paste/file僅本地來源對照，不播放AI動畫。不把general backup restore拿來做追加。

候選核對：保持原來源与unknown，type-aware驗證、new/update position明選、疑似duplicate比對、穩定intake ID/digest。若圖片無法開啟，來源metadata可讀且明示未在本站存圖；不捏造縮圖。

## 6. 保存可靠性

base context在form開啟或preview時計算且不随focus刷新。保存失敗留draft；409重查；401身份变化清draft；超時先GET查收據。scope及load sequence防止異步舊回應污染新身份。

journal root需Worker allowlist/validator/backup/history及所有writer同時支援。舊client忽略journal的普通PUT被拒絕；完整還原需明确preview diff与restore intent。本次不更動D1資料模型，不在request跑DDL。

Undo使用局部inverse与新CAS，不還原整帳。後续已引用／修改則阻擋並說明。not_current只表示不列入目前清單，不代表已成交平倉。

## 7. 實作與驗收邊界

先穩定schema/projection，再完成列表詳頁與候選核對，最後搬回顧／資料管理及shell。應用改完只做一輪桌面手機整批检查、修复、最多一輪确认；發現資料保全錯誤則屬功能未完成，不能為趕視覺收尾略過。

本機fixtures留隔離DB，不進正式帳本或GitHub。正式需讀最新revision與exchange保存狀態；前述交易所确认不等於已保存。規劃者未做任何正式寫入。
