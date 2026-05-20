# Landing Page References — Analysis for PearQuote Redesign

> 方法限制：以下分析基於 WebFetch 抓到的渲染文字、文案、版面與區塊順序。真實 motion / 互動感無法直接觀察，相關判斷是從佈局與文案推回去的，下次最好親自開瀏覽器再校準一輪。

---

## 1. animejs.com

### Hero 為什麼有效

- **文案 hook**：標題「All-in-one animation engine.」只有四個字，定品類；副標「A fast and flexible JavaScript library to animate the web.」兩個形容詞都打在受眾的痛點上（fast = 性能焦慮、flexible = 創作自由）。沒有解釋「what is animation」，因為受眾已經知道。
- **視覺權重**：Hero 沒有放 demo 影片或截圖，**整個頁面本身就是 demo**——Anime.js 拿自己驅動自己的 marketing page。標題下方主視覺只是一段 `npm i animejs` 的安裝指令。
- **權重順序**：Logo → 大標題 → 副標 → 安裝指令（置中、單行、視覺最重） → 「Learn more」純文字次連結。整個 hero 把「能複製貼上馬上跑起來」當主 CTA，**不是按鈕**。
- 為什麼有效：對工程師而言，最強的 conversion 元件不是 button，是「我看到指令、貼進 terminal、它真的會跑」這個瞬間。Anime.js 把這條動線壓縮到了 3 秒以內。

### 信任建立 mechanism（實作層級）

- **頁面本身是 proof**：library 用自己 render 自己；每一次微互動都是一次能力證明，比任何 logo 牆都重。
- **Bundle size 細到單模組**：寫「24.50 KB」並逐模組列出大小，**主動回應「會不會肥」這個 dev 預設懷疑**。
- **九個可跑的 code example**（rotation / SVG morph / draggable / timeline / responsive）。每個都不是 screenshot，是可觸發的互動 demo。用「可重現的 artifact」當社會證明。
- **不靠 testimonial、不靠 star count、不靠 logo wall**。Trust 來自 artifact 品質本身，這是該品類的正解。

### 對 freelancer / 創作者的 emotional hook

- 「Break free from browser limitations and animate anything on the web with a single API.」——**創作解放**的框架，把 user 定位成被工具壓抑的藝術家，而不是工程師。
- 「The complete animator's toolbox」——身份命名：你是「animator」，不是「想做動畫的 dev」。給 identity，比給 feature 更黏。
- 整頁的 motion 本身在販售「我也想做出這種東西」的衝動。賣的是 craft 與 mastery，不是 productivity。

### 哪個設計決定原樣套到 PearQuote 會反效果

| 設計決定 | 為什麼會反效果 |
|---|---|
| **頁面自我 demo**（library 驅動 marketing） | PearQuote 是報價工具，沒有「網頁自己對自己報價」這種等價物。硬塞自我 demo 會變 gimmick。 |
| **以指令當主 CTA**（`npm i animejs` 為視覺中心） | PearQuote 受眾是設計師、攝影師、文案、插畫師，不是 dev。任何 code-shape 的 CTA 都會擋住一半受眾。 |
| **不教品類、只宣稱領導者** | Anime.js 賣給已經知道自己需要 animation library 的人。PearQuote 受眾常常**還不知道自己需要報價工具**（覺得用 Notion 寫一份就好）。所以 landing 不能只展示產品強度，必須教「為什麼這件事不能用 Notion 解決」。 |

---

## 2. neon.com  ← 重點

### Hero 為什麼有效

- **文案 hook**：
  - 標題「Fast Postgres Databases for Teams and Agents」——三層資訊壓在一行內：類別（Postgres）、屬性（Fast）、受眾（Teams + Agents）。**「and Agents」是 2026 年才有的時代戳記**，立刻把品牌定位在 AI era。
  - 副標「Postgres for the AI Engineering era. Integrate with a single command and the LLM does the hard work.」——這句的真正狠處是「**the LLM does the hard work**」：把學習曲線外包給 AI，讓買家覺得自己不用變強就能用。這是 2026 年最有效的 framing。
- **視覺權重**：
  1. 大標題（最重）
  2. 副標（解釋 value）
  3. **滿版 IDE 影片/poster**——把產品放在「你已經在用的環境」裡，視覺上佔最大空間
  4. `$ npx neonctl init`——一行指令，當 simplicity 的具體證據
  5. 右上角兩顆 CTA：「Get started」+「Read the docs」
- **雙 CTA 並排，左承諾、右探索**：「Read the docs」這個次 CTA 對 dev 是「我可以先看再決定」的安全閥，**降低點擊主 CTA 的決策成本**——這個對 dev 受眾非常重要。
- 為什麼有效：在一個 hero 裡同時完成 (a) 品類框架 (b) 時代定位 (c) ergonomics 證明 (d) 雙路徑入口。資訊密度極高但不擁擠，靠視覺權重分層做到。

### 信任建立 mechanism（實作層級）

逐項拆開：

1. **奇數刻意感的 metrics**：
   - 「150,000+ new Postgres compute endpoints provisioned daily」
   - 「41,092 databases deployed」
   - 「**54,210** performance degradations prevented by Autoscaling every day」
   - 注意：數字**不取整**。「54,210」讀起來像 telemetry 直出，「50,000」會像市場部捏的。這是刻意設計的可信度信號。
2. **借用權威**：「A DATABRICKS COMPANY」標籤——被巨頭收購，所有「會不會倒」「能不能用」的疑慮一次被頂掉。對 enterprise procurement 是決定性訊號。
3. **合規 badge**：SOC 2 / HIPAA / ISO 27001 放在 footer。**不放 hero**——因為 hero 是賣感覺，footer 是過 procurement 守門員。位置分工很乾淨。
4. **Live status indicator** 連到 neonstatus.com：「我們敢讓你看 uptime」這個動作本身就是信任。
5. **創辦人可信度**：「founded by Postgres committers」——一句話對「在乎是誰做的」這個 segment 投放精準。
6. **單一 testimonial**（Edouard Bonlieu, Koyeb 共同創辦人）——**peer-to-peer**，不是 logo 牆。創辦人推薦給創辦人，比 50 個 enterprise logo 有效。
7. **GitHub stars 21.9k**：社群驗證，但不是 hero 的主角，是 reinforcer。
8. **產品出現在 IDE 截圖**：證明它住在你已經在用的地方。

### 對 dev / builder 的 emotional hook

- **Aspiration**：成為「ship fast、不管 infra、用 AI 當槓桿」的那種 builder。「Postgres for the AI Engineering era」直接給 identity，買家貼上去就感覺自己變現代了。
- **Pain naming**——這幾句逐字看：
  - 「Eliminate surprises in production deploys」
  - 「Never overpay for resources you don't use」
  - 「Avoid incidents」
  - 每一句都點名一個具體的壞感覺：凌晨被 page、月底帳單嚇到、事故 retro 的尷尬。
- **三重否定當情緒釋放**：「no infrastructure to manage, no servers to provision, no database cluster to maintain」——每一個「no」都是 user 心裡的一個小石頭被搬掉。語言上是排比，心理上是 catharsis。
- **「Instant branching」這個 feature 賣的不是技術**：是「我可以複製 prod、亂搞、丟掉、不會壞東西」這個從恐懼裡解放的感覺。把 Git 的安全感搬到 DB 上。
- **語氣**：empowering + pragmatic。不耍帥、不講術語、不引用論文。

### 哪個設計決定原樣套到 PearQuote 會反效果

| 設計決定 | 為什麼會反效果 |
|---|---|
| **巨型刻意感 metrics**（150,000+ / 54,210 daily） | PearQuote 是 early-stage。如果數字小，揭露反而扣分；如果數字假或四捨五入過頭，懂的人一眼看穿。**真實數字 < 五位數前不要學這招**。等到 metric 自己會說話再上。 |
| **借用權威**（Databricks 標籤等價物） | PearQuote 沒有等價的母品牌。硬塞「Powered by GPT-4」「Built on Vercel」這種 stack badge 給創作者看，會讀成 cope，不是 cred。 |
| **Compliance badge 牆**（SOC 2 / HIPAA / ISO） | Neon 受眾是 B2B infra buyer，badge 是過 procurement 必需品。PearQuote 受眾是個人創作者，badge 會讀成「冷冰冰的公司」，**投射距離而不是信任**。 |
| **「AI Engineering era」這種時代 framing** | 創作者不會自稱 AI Engineer。他們是設計師、攝影師、文案。Tech-stack 詞彙會讓人覺得「這不是給我用的」。需要找等價的、屬於創作者的時代詞（例如「給接案者的價格安全感」之類，再修）。 |
| **雙 CTA「Get started / Read the docs」** | 對 dev，「docs」是安心；對創作者，「docs」是作業。次 CTA 應該更輕——例如「看一份範例報價」「不用註冊先試看看」。**不要叫創作者去讀文件**。 |
| **產品截圖放 IDE 環境** | Neon 把產品放在 user 已經在的 IDE 裡，是「我們長在你的生態」的訊號。PearQuote 不應該模仿這種「住在工具裡」的擺法，因為創作者的「環境」是分散的（Mail、IG DM、LINE、Figma 旁邊）——應該擺的是**情境**（一場真實的接案對話）而不是工具。 |

**可以學的部分**：
- 雙 CTA 的決策成本分層（一個承諾、一個探索）——但要重寫文案。
- 三重否定式的痛點命名（no X, no Y, no Z）——這個 pattern 對「接案的痛」非常適用：「不用 Google 對手價、不用半夜算成本、不用怕報太低」。
- Peer-to-peer 的單一 testimonial 比 logo 牆有效——PearQuote 應該找一個有口碑的接案者寫推薦，而不是堆 logo。
- Section 順序的節奏：問題 → 怎麼解 → 為什麼信我 → 再 CTA。Neon 走的是這個節奏。

---

## 3. gsap.com

### Hero 為什麼有效

- **文案 hook**：標題「Animate Anything」兩個字，極致的品類承諾。副標「A wildly robust JavaScript animation library built for professionals」——「**wildly**」這個字在做真正的工作：把工程感（robust）跟性格（wildly）綁在一起，避免讀起來像企業文宣。
- **視覺權重**：動畫蠕蟲（worm graphic）+ 標題文字繞著它碎裂重組。和 Anime.js 一樣，**頁面自己 demo 自己**。蠕蟲帶來俏皮感，文字碎裂展示 typography 能力。動畫是 hero 的真正主角，文字是配角。
- **CTA「Get GSAP」**：用「擁有」而不是「開始」。心理上比「Get started」重一格，因為暗示「這個東西會變成你的」。
- 為什麼有效：用 motion 本身證明能力，省下所有「我們能做什麼」的解釋。看完 hero，user 自己已經知道這個 library 強。

### 信任建立 mechanism（實作層級）

- **Showreel section**：列出真實 client work（Studio375、Maxima Therapy、Joseph Santamaria、MERSI Architecture、San Rita）+ video showreel。
- **關鍵動作**：每個 showcase **同時列出用到的 plugin**（ScrollTrigger、SplitText、MotionPath 等）。這是雙效信任建立：
  1. 證明真實生產環境在用
  2. 教 user「這個效果是哪個工具做的」——把社會證明跟功能教學壓在同一個視覺塊裡
- **不放 Fortune 500 logo**，放設計工作室名字。受眾是 creator，creator 尊重 creator。如果這裡放 IBM 反而會降低 cred。
- **不主推 GitHub stars**。GSAP 不靠 OSS health 賣，靠 craft 賣。
- 整頁本身是持續的動畫展示——和 Anime.js 同樣的「artifact = trust」邏輯。

### 對 freelancer / 創作者的 emotional hook

- **「Animate Anything」**：omnipotence。你變得無所不能。
- **「Focus on the fun stuff」**：承諾把無聊的事拿走。**這對 freelancer 是夢幻句子**——做案子最累的不是創作本身，是周邊雜事。GSAP 把自己包裝成「移除雜事的工具」。
- **「Built for professionals」**：給身份。你不是業餘玩家，這是給認真的人用的。**抬高 user 而不是抬高自己**。
- **語氣**：playful + competent。「wildly robust」把瘋狂跟可靠並置，這種雙性格的 voice 在 creator 圈非常有效。

### 哪個設計決定原樣套到 PearQuote 會反效果

| 設計決定 | 為什麼會反效果 |
|---|---|
| **俏皮蠕蟲 + 碎裂文字當 hero** | PearQuote 賣的是**錢的信任感**。Freelancer 把自己的生活費換算依據放進這個工具，他們要的視覺是穩、是可靠，不是好玩。**Whimsy 在金錢工具裡讀成不專業**。 |
| **「Animate Anything」式的萬能承諾** | 對動畫 library，「anything」是合理的品類承諾。對報價工具，「任何報價都能做」立刻引發 user 想 edge case：「那 retainer 呢？訂閱制呢？分期交付呢？」——萬能承諾在工具型產品會反向引發懷疑。**要具體**，例如「設計案、攝影案、寫作案開箱即用」。 |
| **Plugin-named showreel pattern** | PearQuote 沒有 plugin，有 feature。直接照搬不 map。但**精神可學**——可以把不同類型的範例報價（婚禮攝影、品牌設計、長文撰稿）做成 showcase，並標註每份用到的功能（AI 精算 / 多階段付款 / 風險條款）。 |
| **「Built for professionals」當口號** | 這句對動畫師（有清晰的職業身份的 tribe）有效。Freelancer / 創作者群體混雜，**很多有 imposter syndrome**——「我夠不夠資格自稱 professional？」「Built for professionals」會讓他們覺得「這不是給我用的」。應改成更包容的 framing，例如「給認真接案的人」「給把作品當生意做的人」。 |

---

## 跨三站的綜合觀察（給 PearQuote 的直接 takeaway）

1. **三站共通的 hero 戰術**：用一個能立刻產生信任的具體 artifact 當視覺中心。Anime.js 用 `npm i`、Neon 用 IDE + terminal command、GSAP 用 motion 本身。PearQuote 的等價物應該是**一份真實的範例報價**（不是按鈕、不是 hero illustration）——讓 user 一眼看到「成品長這樣」。
2. **誰的信任 pattern 最適合 PearQuote**：Neon 的 peer testimonial + 痛點三重否定 + 雙 CTA 分層，但去掉 metric 牆與 compliance badge。Anime.js 與 GSAP 的「artifact = trust」邏輯不直接適用，但「showcase 同時當 feature 教學」這招（GSAP 的 plugin attribution）可以借。
3. **三站都迴避的事**：沒有任何一站在 hero 講「founded in」「team of N」「raised $X」這種公司資訊。Hero 全部都在賣**user 變成什麼**，不在賣**我們是誰**。
4. **language register**：三站都不正經、都有性格（wildly robust / break free / the LLM does the hard work）。PearQuote 的繁中文案要不要走這個方向，是一個需要先決定的策略選擇——目前的 Voice 偏中性，這在 freelancer 受眾上會稀釋情感。

---

## 待你決定（review 後再開新 session 改 code）

- PearQuote 的 hero 主視覺要選哪個方向：**範例報價** vs **接案者人物 + 場景** vs **產品 UI 螢幕截圖**？我有偏好但等你先說。
- 文案 voice：偏 Neon 的 pragmatic empowering、偏 GSAP 的 playful confident、還是另起一格的繁中接案者語感？
- 信任區塊的順序：問題命名 → 解法 → 證明（Neon 順序），還是 解法 demo → 證明 → 問題命名？這跟受眾「是否已經知道自己有這個問題」直接相關。
