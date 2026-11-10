---
name: aidd-init
description: 空のリポジトリにコアを置いた状態から、コアを main に push し、全体設計（000-overall）を始める。
disable-model-invocation: true
---

# aidd-init

あなたはプロダクトリードとして、全体設計（000-overall）を始める。

## 手順
1. git のリポジトリでなければ `git init -b main` を実行する。リモート（origin）が無ければ、止まって人に登録を頼む。
2. `.claude/aidd/node_modules` が無ければ `npm ci --prefix .claude/aidd` を実行する。.gitignore に `node_modules/` と `.claude/settings.local.json`（人の手元の設定）と `specs/*/results/spec-book.html`（仕様の全体のページ。Gate のページを作るたびに作り直し、コミットしない）が無ければ足す。
3. hook が効いているかを自分で試す（人に頼まない）。(a) Bash で `git config --global --get user.name` を流し、guard-bash に止められることを確認する（読むだけのコマンドなので、止められずに流れても害は無い）。(b) `specs/_current/_intent/intent.yaml` がまだ無ければ、Write でそこに `users: 1` とだけ書き、validate-artifacts が違反を返すことを確認してから、そのファイルを消す（`rm`。まだコミットしていない）。どちらかが効いていなければ、止まって、`/hooks` で guard-bash（PreToolUse）と validate-artifacts（PostToolUse）が読み込まれているかを確認するよう人に頼む
4. `git status --porcelain` に、コア（CLAUDE.md、.claude/、.mcp.json、.gitignore）のほかの変更があれば、止まって人に伝える。コアを `node .claude/aidd/bin/commit.mjs --core -m "aidd(core): コアを置く"` で main にコミットし、`git push -u origin main` を実行する。続けて `gh api -X PATCH repos/{owner}/{repo} -F allow_squash_merge=true -F allow_merge_commit=false -F allow_rebase_merge=false -f squash_merge_commit_title=PR_TITLE -f squash_merge_commit_message=BLANK` で、マージの仕方を squash（PR のコミットを 1 つにまとめて main に入れる）だけにし、squash のコミットの題を PR の題にし、本文を空にする。main の履歴はチケットごとに 1 つのコミットになり、細かいコミットは PR に残る。本文を空にするのは、Gate 2 の提出のコミットの文の `[skip ci]` が main のコミットに写ると、main の CI が流れないため。squash ではチケットのブランチの先が main の祖先にならないので、マージ済みかは /aidd-run の「マージ済みの決め方」で決める。失敗したら、止まって人に伝える。
5. main から aidd/000-overall を作り、`specs/000-overall/status.yaml` を `.claude/aidd/templates/status.yaml` の形で（説明のコメントは写さない）、ticket_id: 000-overall、state: ヒアリング中、main_checked_at に main のコミットを書いて作り、`node .claude/aidd/bin/commit.mjs --orchestrator -m "aidd(000-overall): 始める" specs/000-overall/status.yaml` でコミットする。
6. push し、`gh pr create --draft --base main --title "000-overall 全体設計" --body "全体設計の聞き取り中"` で下書きの PR を作り、番号を pr に書いてコミットし、push する。
7. 参考資料があれば、人に `specs/_references/` に置いてもらい、`--orchestrator` でコミットする。
8. 続けて、/aidd-run 000-overall と同じ手順で、壁打ちから始める。
