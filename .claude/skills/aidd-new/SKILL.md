---
name: aidd-new
description: 機能のチケットを足す。後で切り出す範囲（later）から切り出すことも、思いついたことを later に置くだけにすることもできる。
argument-hint: [英語の名前か、later の id]
disable-model-invocation: true
---

# aidd-new

あなたはプロダクトリードとして、新しい機能のチケットを足して始めるか、後で切り出す範囲（later）に置く。

## 手順
1. `git fetch origin --prune`。`git status --porcelain` が空でなければ、止まって人に伝える。000-overall が main にマージ済み（/aidd-run の「マージ済みの決め方」。origin/main の status.yaml が受入済）でなければ、止まって伝える。
2. 何を足すかを決める。
   - $0 が origin/main の ticket-plan.yaml の later の id なら、その行から切り出す（3 に進む）。
   - $0 がまだマージされていない later/<$0> のブランチにしか無ければ、その PR をマージしてからもう一度 /aidd-new <$0> と伝えて止まる。PR がぶつかっていれば（`gh pr view <PR> --json mergeable` が CONFLICTING）、先に later/<$0> に切り替え、別のコマンドで `git merge origin/main` を実行し、later の行を両側とも残して解いてコミットし、push してから、元のブランチに戻る。
   - どちらでもなければ、足したいものを人に一言で聞き、英語の名前を決める（$0 があればそれを使う）。続けて、今始めるか、後に回す（later に置くだけ）かを AskUserQuestion で問う（人の一言で「後で」と分かれば問わない）。後に回すなら、下の「later に置く」に進む。
3. 001-foundation が main にマージ済み（1 と同じ決め方）でなければ、止まって伝える。番号を決める：origin/main の ticket-plan.yaml の行と、origin/main の `specs/` の下のチケットのフォルダ（閉じた流れのチケットは、行が消えてフォルダだけが残る）と、リモートの aidd/ ブランチの番号のうち、最大の次。チケットの ID は `<番号>-<英語の名前>`。
4. origin/main から aidd/<ID> を作り、/aidd-run の「開始時の確認」の 5 と同じく status.yaml（state: ヒアリング中）と下書きの PR を作る（ticket-plan.yaml の行と依存の条件は確認しない。行は仕様担当が聞き取りの中で足す）。
5. 続けて、/aidd-run <ID> と同じ手順で、壁打ちから始める。

まだ始めていないチケットをやめるときは、PR を閉じてブランチを消す（main に入る前なら、ほかに直すものは無い）。

## later に置く
status.yaml は作らず、壁打ちにも入らない。ticket-plan.yaml は仕様担当が書くものだが、この道に限り、プロダクトリードが later に 1 項目だけ足す（ほかの行は変えない）。

1. 項目を決める。id は英語の名前（小文字とハイフン）で、origin/main の later の id、チケットの英語の名前（ticket-plan.yaml の行と、リモートの aidd/ ブランチ）、リモートの later/ ブランチと重ならないもの。title は短い日本語の名前。reason は「<人の一言>（思いついたときに後に回した）」の形にする。何をしたいかが一言から分からなければ 1 問だけ聞く。
2. 今のブランチを覚え、`git switch -c later/<id> --no-track origin/main` で切り替える。specs/ticket-plan.yaml の later の末尾に、ほかの項目と同じ 1 欄 1 行の形で 1 項目（id、title、reason）を足す。
3. 切り替えとは別のコマンドで `git add specs/ticket-plan.yaml` と `git commit -m "later: <title> を後で切り出す範囲に置く"` を実行する（aidd/ の外のブランチなので commit.mjs は使わない）。`git push -u origin later/<id>` の後、`gh pr create --base main --title <コミットのメッセージ> --body-file <ファイル>` で PR を作る（下書きにしない。本文は `git rev-parse --git-common-dir` の下の `aidd/tmp/later/` にファイルで書き、足した項目と、マージすると /aidd-new <id> で切り出せることを書く）。
4. 覚えたブランチに戻り、手元の later/<id> を消す。人には、PR の URL と、マージすると /aidd-status の later に並び、/aidd-new <id> で切り出せることを伝える。
