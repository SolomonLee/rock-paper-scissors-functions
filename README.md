# 剪刀石頭布 展示專案 後端 之 API

[展示前端 網址](https://rock-paper-scissors-5b04b.web.app/).

-   採用  
    Firebase Functions

-   各 API  
    onCreateUser 當使用者建立帳戶時建立 相關資料  
    getGamerInfo 取得登入的遊戲者資訊  
    getGameRooms 取得房間列表(可未登入使用)  
    insertGameRoom 取得房間列表  
    getGameConditions 取得遊玩方式(可未登入使用)  
    joinGameRoom 加入指定房間  
    leaveGameRoom 離開指定房間  
    gameStart 遊戲開始, 適用於遊戲等待中  
    gameReady 遊戲準備, 當遊戲進行中時, 最後一個玩家準備時, 將自動結算, 並 重新開始 或 結束遊戲
