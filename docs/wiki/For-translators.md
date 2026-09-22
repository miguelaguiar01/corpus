Somebody sent you a link and a password. This page is everything you need; you will not have to read anything else on this wiki, and you never touch the code.

## Getting in

The first time, you join with an invite secret, a display name and a password of at least eight characters. Every time after that it is your name and your password.

There is no email anywhere, which means there is no reset link. If you forget your password, ask whoever runs the instance: they can reset it and give you a temporary one, which you change as soon as you sign in.

## What to work on

The project's first page has two things: **Progress**, which is how much of each language is done, and **What to work on**, which is the queues.

- **Untranslated** — no translation at all. This is the normal pile.
- **Stale** — somebody changed the source text after your translation was saved. The old translation is still there; it needs checking, not redoing.
- **Unverified source** — source text nobody has proofread yet. Only for whoever is checking it.
- **Agent drafts** — translations a machine drafted, waiting for a person. The queue is not shown when there are none.

Open a queue and you are in the editor, on the first string, with **Next** and **Previous** to move through it. Work down a queue rather than hunting the catalogue: the queues exist so you never have to decide what is next.

## The editor

The source text and your translation sit side by side on a wide screen, and one above the other on a narrow one. **Save translation** commits it; there is no autosave, and nothing is lost when you move away, because a string you have not saved is simply not saved.

Some strings have more than plain text in them, and those parts must survive into your translation. You never type them by hand.

**Placeholders** are values the application drops in — a name, a count, a date. They appear as chips below the box; click one to insert it. The same placeholders shown in the source text carry a tooltip saying what each one holds, and sometimes a grammatical hint about what arrives.

You cannot save a translation that has lost one. The editor checks as you type, lists what is wrong under the box, and **Save translation** stays disabled until it is right — so the mistake is caught where you made it rather than after you moved on.

**Selects and plurals** are a choice of wording. A plural is not always two branches: the editor offers the branches *your* language uses, which is anything from one (Japanese, Chinese) to four (Russian, Polish, Czech), five (Irish) or six (Arabic, Welsh). Most languages have the two English has, so the ones that do not are easy to be caught out by. Use the chip, fill each branch, and let the editor tell you if one is missing.

**Tags** are formatting — bold, a link — that the application fills in. Keep them, keep them in a sensible place for your language, and do not invent new ones.

## What helps you decide

Beside the string you will find, when they exist:

- **How every string of this type reads** — the register somebody set for this kind of text. Read it once per kind and it will save you arguing with yourself.
- **Glossary terms in this string** — words this project has already decided how to render, with the agreed translation and sometimes a note. Follow them; they are there because two people disagreed once.
- **Examples** — real values for the placeholders. The **Preview** shows the string as a person will actually read it, with those values substituted into what you are typing, updating as you type.
- **Siblings** — the other strings near this one, with their translations. This is how you keep a set of buttons consistent without remembering what you did last week.
- **Related** — the people, places or things the string mentions, with their names and details, so a character is called the same thing in every string.
- **Other languages** — what your colleagues did with the same string. Often the fastest answer.
- **History** — every edit to this string, who made it and when.

## The three states

A string in a language is **untranslated**, then **translated** once somebody saves one, then **verified** once a maintainer signs it off. You move it to translated; only a maintainer moves it to verified.

**Stale** sits on top of any of those. It means the source text moved after the translation was saved. The editor shows a banner and keeps the old translation so you can see what changed rather than starting again.

Verified is the state that reaches the code. Whoever runs the project can choose to take translated work too, but not less than that, so until somebody verifies yours it usually lives in Corpus and nowhere else.

## When the source text is the problem

Sometimes a string cannot be translated well because of what it says: it is ambiguous, it assumes the grammar of the language it was written in, it is wrong. Do not work around it in your language.

**Propose a change.** Write what the source text should say. It goes to the people who own the code, who review it like any other change to the application, and if they take it, the string changes for everybody and every language. You can also propose removing a string, or adding one that is missing.

A proposal is pending until it reaches the repository. You will see it marked on the string, and its status change when it lands.

## Things that will happen

**You cannot press Save translation.** Something under the box says what is wrong: a missing placeholder, a plural branch your language needs, a tag you dropped. Fix it and the button comes back.

**The string is read-only.** Either it is archived, meaning the application no longer has it, or it is the source language, which is changed by proposing rather than by editing.

**Somebody else edited it while you had it open.** You will be told. The last save wins; nothing is lost, because the history has both.

**A string went back to stale that you already did.** The source text changed again. It happens most on a project under active development, and it is not a comment on your work.
