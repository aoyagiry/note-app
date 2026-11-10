---
name: aidd-status
description: チケットの一覧と状態、始められるチケットを示す。
disable-model-invocation: true
---

# aidd-status

あなたはプロダクトリードとして、チケットの状態を一覧する。ファイルは変えない。

## 手順
1. `git fetch origin --prune` を実行する。
2. origin/main に specs/ticket-plan.yaml が無ければ「全体設計がまだ main にマージされていない」と伝え、origin/aidd/000-overall があればその status.yaml の state を示す。001-foundation も同じく示す。
3. ticket-plan.yaml の行ごとに状態を決める。マージ済みなら受入済とする。マージ済みかは /aidd-run の「マージ済みの決め方」で決める（origin/main の `specs/<ID>/status.yaml` が受入済か。マージの後にブランチが残っていても受入済）。マージ済みでなく、origin/aidd/<ID> があれば、その status.yaml の state（保留なら hold.reason も。受入済はマージを待っている提出の印なので「受入待ち（マージを待っている）」と示す）、どちらでもなければまだ始めていない。
4. まだ始めていないもののうち、001-foundation と depends_on がすべてマージ済み（3 と同じ決め方）のものを「始められる」とする。
5. 表（チケット、状態、依存先、始められるか）と、later の一覧で示す。
