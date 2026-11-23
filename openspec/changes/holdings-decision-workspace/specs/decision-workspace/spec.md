本文件中的標的、交易所與拓撲示例是合成驗收資料，不描述私人持倉。

## ADDED Requirements

### Requirement: 持倉優先入口
系統 SHALL 將買賣決策入口預設為可掃讀的目前持倉清單，保留每一獨立部位，並在快照資料旁標示其時間能力。

#### Scenario: 十個既有持倉畫面
- WHEN 使用者進入workspace=ledger且有10個原快照
- THEN 以10個獨立部位呈現，TESTA與TESTB各兩筆、TESTC多空分開
- AND 入口可見「依已保存快照」及各列日期未確認狀態
- AND 不生成BUY、不出現整體報酬KPI，也不把records空集合顯示成沒有持倉

#### Scenario: 畫面與成交帳本同時存在
- WHEN 同標的同時有快照與records計算持倉
- THEN 分別標示來源和計算範圍，不相加或自動判定為不同實際資產
- AND 無法確定重疊時分列來源計數，不給混合總資產

### Requirement: 穩定部位身份
系統 SHALL 以穩定position ID辨識部位，symbol只供視覺分組。

#### Scenario: 同標的不同交易所或分倉
- WHEN 存在同symbol的不同交易所／商品／方向或多個分倉
- THEN 每部位可獨立選擇、查看來源及記錄理由
- AND 不以symbol、槓桿、價格、數量作唯一鍵或去重充分條件

#### Scenario: 更新已知部位
- WHEN 使用者匯入可能屬於既有部位的新畫面
- THEN 必須明選建立新部位或更新既有部位
- AND 舊快照保留；unknown日期不能自動成為市場最新畫面

### Requirement: 同頁決策脈絡
系統 SHALL 在可深連結的標的詳頁同時承載摘要、時間線、理由與回顧。

#### Scenario: 讀取特定部位
- WHEN 使用者從列表選擇一個部位
- THEN 進入有URL的詳頁並選中該部位
- AND 可以在同頁讀到所選事件的當時理由與後續回顧，不需跳另一全域回顧頁
- AND 返回恢復原列表篩選和位置

#### Scenario: 原快照沒有理由
- WHEN 選中的原快照沒有決策文字
- THEN 顯示尚未記錄理由及補記入口
- AND 不由AI、盈虧或價格推測理由

### Requirement: 日期與觀測誠實
系統 MUST 保留未知日期、未知時區與未知數量，不將匯入時間冒充市場事件時間。

#### Scenario: 日期未知
- WHEN captured_date為null
- THEN 顯示日期未確認並放入時間線獨立區
- AND 系統保存日期只以記錄時間標示，不插入假當日交易

#### Scenario: 有本地時間但無時區
- WHEN observed_history有local_datetime且timezone為null
- THEN 保留原日期時間並標明時區未確認
- AND 不轉UTC、不宣稱跨交易所精確先後

### Requirement: 金額與計算口徑
系統 MUST 按原欄位語意和單位展示，不以畫面證據擴張計算能力。

#### Scenario: 永續投資額
- WHEN snapshot包含investment、extra_margin、leverage、total_profit
- THEN 各值語意不變，investment乘leverage不作名目曝險，total_profit不改叫純未實現盈虧
- AND 快照不加入replayLedger或績效

#### Scenario: TESTTOKEN多幣別
- WHEN 價格／估值為TWD且盈虧為USDT
- THEN 每欄保留單位，不反推匯率或相加
- AND 缺值顯示未提供，不補0

### Requirement: 單一新增入口
系統 SHALL 提供一個主要「新增紀錄」action，預設從截圖整理，手動和CSV為其他方法。

#### Scenario: 從部位新增
- WHEN 使用者在詳頁選新增紀錄
- THEN 帶入標的／部位context進composer，仍需明選資料種類與核對
- AND 不自動建立成交或把snapshot改成BUY

### Requirement: 真實AI接力
系統 MUST 只呈現已存在的解析能力。

#### Scenario: 沒有站內模型端點
- WHEN 使用者選從截圖整理且站內無已授權模型
- THEN 提供貼到既有ChatGPT對話、匯入整理結果、核對保存的可完成流程
- AND 不顯示假的上傳成功、辨識中、信心百分比或解析結果
- AND 本機選图只稱核對預覽，不發送圖片或索取新憑證

#### Scenario: AI結果格式錯誤
- WHEN 候選包格式不符或缺必要型別
- THEN 顯示可定位的錯誤與修復／手動核對方式，保留合法本地draft
- AND 不直接將候選寫入正式state

### Requirement: 來源核對與隱私
系統 SHALL 支援來源metadata和可選本機圖片比對，且不得把私人原圖放進靜態發布。

#### Scenario: 原圖不在本站
- WHEN 來源只有檔名／hash／Library ID
- THEN 顯示原圖未保存於本站及可重新選圖比對
- AND 不產生假縮圖、假下載URL或公開Library資產

#### Scenario: hash未知
- WHEN 無法核實原檔SHA
- THEN 保存null與未核對來源狀態，不捏造hash
- AND 不據此宣稱原檔重複或完整驗證

### Requirement: 成交證據與完整成交分型
系統 MUST 將不完整證據及不支援品種帳務與可重播records分開。

#### Scenario: 兩筆不完整買入
- WHEN 讀取原TESTTOKEN的兩筆observed_history
- THEN 保留數量及原畫面日期，顯示待補成交資料
- AND records不增加，成交價／費用／時區不補造

#### Scenario: USDT永續資料
- WHEN 匯入或手動紀錄USDT永續成交內容
- THEN 可保存為execution_evidence供時間線閱讀
- AND 不填成USD、不進僅支援ticker+三字母currency的現有現貨重播

#### Scenario: 只有成交證據沒有持倉畫面
- WHEN 使用者提供合法成交證據但沒有snapshot
- THEN 可用最小instrument容器保存並從所有紀錄／詳頁找到
- AND selected_snapshot_id為null，不造空snapshot或計入目前持倉

### Requirement: 增量候選匯入
系統 SHALL 使用專用候選format增量合併，禁止將日常新增當作整帳還原。

#### Scenario: 核對批次
- WHEN 使用者完成逐筆類型／值／來源／部位／重複核對
- THEN 預覽新增、追加、證據、略過的明確筆數並明確保存
- AND 保留research、finance、imports、snapshots、favorites等原state切片

#### Scenario: 誤放完整備份
- WHEN 在截圖候選入口貼上investment-ledger-v1
- THEN 拒絕作新增並提供到資料管理還原預覽的入口
- AND 不覆寫當前state

### Requirement: 多層重複處理
系統 SHALL 分別處理重送、同檔與跨圖片段，不把同symbol直接去重。

#### Scenario: 相同intake重送
- WHEN 已保存相同intake ID及content hash
- THEN 返回／顯示原批次為已保存，0新增

#### Scenario: 跨圖重疊
- WHEN 不同來源SHA出現疑似同部位片段
- THEN 並列差異讓使用者選同觀測／不同部位／待確認
- AND 原TESTD仍是一個快照與兩個來源，不丟其他候選

#### Scenario: 不同包有相同候選名
- WHEN 兩個不同package都使用candidate-1且來源SHA未知
- THEN 候選ID只在包內唯一，不跨包自動略過
- AND 只有已核實的包身份與內容／來源候選鍵才能建議重複

### Requirement: 決策與事後補記
系統 SHALL 分開當時已有來源的文字、新決定和事後補記。

#### Scenario: 對歷史快照補理由
- WHEN 使用者今天為舊快照輸入理由
- THEN 以事後補記標記保存，保留真實created_at
- AND 輸入舊event_date不能將其變成當時已記錄

#### Scenario: 回顧判斷
- WHEN 使用者記錄後續回顧
- THEN 綁明確原事件，保存證據、outcome及下一步
- AND 盈虧正負不自動決定outcome

### Requirement: 草稿與保存成功
系統 SHALL 成功後才關閉編輯器，失敗保留同owner輸入。

#### Scenario: 保存失敗
- WHEN PUT回422／500或offline
- THEN 表單及候選留在原處並顯示可恢復錯誤
- AND 多欄錯誤提供可聚焦且可跳到欄位的摘要，不只toast

#### Scenario: 保存結果未知
- WHEN 網路中斷但server可能已保存
- THEN 先GET核對穩定ID與digest，再顯示成功或重新核對
- AND 不盲目新建第二批或宣稱已完成

### Requirement: 編輯基準與CAS
系統 MUST 在編輯或preview開始固定身份與revision，禁止自動替換基準。

#### Scenario: 其他分頁修改收藏
- WHEN form開啟後另一分頁更新favorites，回到本頁造成focus reload
- THEN 舊draft保持舊base且被標為stale
- AND 必須載入最新完整state再核對delta，以新的明确保存動作提交，不丟收藏

#### Scenario: 版本衝突
- WHEN server回409
- THEN 保留同owner draft並提供載入最新後重新核對
- AND 不自動覆寫或last-write-wins

### Requirement: 身份與非同步隔離
系統 MUST 防止舊身份draft、來源和異步回應出現在新身份。

#### Scenario: 身份改變
- WHEN owner_scope變化或401/identity_changed
- THEN 清畫面、draft、候選、圖像object URL和歷史
- AND 異步舊回應不重建這些內容，重新登入後從新scope讀取

### Requirement: 附加域與舊資料相容
系統 SHALL 保留舊state与新journal共存，不在首次讀取寫入遷移。

#### Scenario: 讀取v13
- WHEN 沒有journal的舊state開啟新介面
- THEN 以read-only projection呈現，server revision及原state不變

#### Scenario: 舊client省略journal
- WHEN server已存在journal但普通PUT缺journal
- THEN 拒絕保存並要求更新client，不能把新域清掉

#### Scenario: 舊備份完整還原
- WHEN 使用者明選不含journal的舊備份進完整還原
- THEN 預覽明列将取代的全部區域及journal筆數，先保全原資料，使用明确restore intent及CAS
- AND 不將這個例外套用到普通新增保存

### Requirement: 範圍限定撤回與復原
系統 MUST 將单次undo限制在該次變更，保留其他切片及後續依賴。

#### Scenario: 撤回新增批次
- WHEN 該批候選仍未修改且無後續引用
- THEN 以新CAS撤回本批相關項，其他收藏／研究／資金不回滚
- AND 保留來源和批次收據／歷史

#### Scenario: 已有後續回顧
- WHEN 待撤回部位已新增理由、回顧或其他關聯
- THEN 阻擋批次undo並列出影響，不連帶刪除或只撤一半

#### Scenario: 撤回對既有部位的追加
- WHEN 批次為舊position追加新snapshot並改選摘要，且無後續變更
- THEN 用inverse metadata恢復原選取及關聯，而非將舊position隱藏
- AND 新觀測以withdrawn receipt保留且不再透過legacy fallback變成幽靈持倉

#### Scenario: 不再列為目前持倉
- WHEN 使用者變更列表visibility
- THEN 不生成SELL、不增加已實現盈虧、不聲稱交易所已平倉

### Requirement: 響應式與可及性
系統 SHALL 支援320/390px手機、桌面、鍵盤、文字縮放與正常表單回饋。

#### Scenario: 手機核對
- WHEN 使用者在390px核對多筆候選
- THEN 一次一筆有進度、可看來源、回上一步不丟輸入，sticky保存不遮內容
- AND 不以橫向溢出取代重新排版

#### Scenario: 鍵盤編輯
- WHEN 以鍵盤開啟drawer、保存失敗、取消並返回
- THEN 有可見focus、正確焦點陷阱／釋放、欄位錯誤連結及返回觸發點
- AND 所有核心action有44px產品目標、正常文字4.5:1對比，無hover-only關鍵資訊

### Requirement: 原研究與收藏不退化
系統 MUST 保留原報告、比較、觀察、來源、歷史以及公司列表新功能。

#### Scenario: 新journal後保存收藏
- WHEN 使用者組合搜尋／產業／上市市場／只看收藏並保存星號
- THEN 原篩選與URL仍有效，reload後收藏存在，journal與快照不變
- AND 不依公司總部推導上市市場

#### Scenario: 公司我的紀錄
- WHEN 公司有可確認對應的快照而無records
- THEN 能連到相應持倉詳頁且不說尚無持倉
- AND 股票代幣／永續與公司現股的關係未確認時不自動對應

### Requirement: 局部限制與資料管理
系統 SHALL 移除主閱讀冗文但保留可操作且誠實的限制。

#### Scenario: 主持倉首屏
- WHEN 顯示持倉列表
- THEN 不顯示手動記錄宣傳句、正式domain大段、全量重播限制文字或10個交易所編輯按鈕
- AND 日期／來源與實際計算缺口仍在對應資料附近可見

#### Scenario: 匯出私人資料
- WHEN 使用者進資料管理
- THEN D1完整備份與browser IndexedDB來源判斷備份分開說明且可用
- AND 匯出、歷史、還原、CSV原功能不消失
