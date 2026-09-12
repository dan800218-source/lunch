# 揪團吃飯｜公司訂餐系統

給同事在手機上即時一起訂餐的靜態網頁：不用登入、人人可開單、可幫別人點，資料存在 Supabase，**每人一筆列資料**，不會再把整份狀態覆寫掉。

## 功能

- 進入網站優先導向**進行中訂單**（以餐廳名分頁），沒有進行中訂單才到新增訂單
- 新增訂單：餐廳、截止時間（預設 2 小時後）、餐點與金額，可帶入常用餐廳
- 進行中訂單：選人名、餐點、數量後送出，即時顯示目前狀態
- 人員名單：新增／編輯，頭像顏色區分部門
- 常用餐廳：儲存餐廳與餐點金額
- 付款確認：截止後統計每人金額，付款狀態僅供紀錄
- 未繳費統計：未繳訂單、餐點、金額
- 管理者：密碼進入後可改進行中／已截止訂單，並保留版本紀錄
- 歷史訂單：餐點份數與金額統計，方便叫餐
- 所有刪除（含提早結單）都有防誤觸確認

## 第一次設定

1. 開啟 [Supabase SQL Editor](https://supabase.com/dashboard)，執行專案裡的 `supabase-schema.sql`
2. 在 `config.js` 填入專案 URL 與 anon public key（目前已帶入既有專案）
3. 管理者密碼預設為 `953618`，可在 `config.js` 的 `adminPassword` 修改

## 本機預覽

用任何靜態伺服器開啟根目錄即可，例如：

```bash
npx --yes serve .
```

## 部署到 GitHub Pages

1. 把這個 repo 推到 GitHub
2. Settings → Pages → Source 選 `main` 的 `/ (root)`
3. 開啟 Pages 網址即可給同事用

Realtime 需在 Supabase 將 `people`、`restaurants`、`restaurant_menu`、`orders`、`order_menu`、`order_items`、`order_versions` 加入 `supabase_realtime` publication（schema 檔已包含）。
