# 平台与接口

get-usage-data 在下列平台的用量页显示按钮，并旁听页面发往指定接口的响应。

## DeepSeek

- 显示页面：<https://platform.deepseek.com/usage>
- 拦截接口：`GET https://platform.deepseek.com/api/v0/usage/` 下的全部端点，以及账户概要 `GET https://platform.deepseek.com/api/v0/users/get_user_summary`

## ClinePass

- 显示页面：<https://app.cline.bot/dashboard/usage>
- 拦截接口：`GET https://api.cline.bot/api/v1/users/<用户 ID>/usages/daily`，查询参数为 `startDate` 与 `endDate`

用户 ID 随账号不同，脚本按路径的其余各段匹配，不限定具体账号。

## Command Code

- 显示页面：`https://commandcode.ai/<语言>/<用户名>/settings/usage`，语言段可以省略
- 拦截接口：`GET https://api.commandcode.ai/internal/usage/by-model`

用户名随账号不同，脚本按路径的其余各段匹配，不限定具体账号。

## QoderCN

- 显示页面：<https://qoder.cn/account/usage>
- 拦截接口：`GET https://qoder.cn/api/v1/me/cost-center/credits/daily-trend` 与 `GET https://qoder.cn/api/v1/me/usages/big_model_credits/histories`
