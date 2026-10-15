---
name: brand-film-vo-script
description: Write the timed voice-over script for a brand film or any short video that already has a picture - lines that argue the brand's position instead of describing the screen. Use for any voice-over, narration or VO script request, "what should the voice say", or when a script is called bland or accused of repeating the picture.
---

# Voice-over script for a film

Write the words a voice will speak over a film that already exists: a brand film, a launch video, a reel. The script is timed to the picture, short enough to breathe, and says something the picture does not.

## The lesson this skill exists for

The first script written for the reference film walked through the shots and named them. The client's reply: **"the script is too bland and it just says what's on the screen."** They were right. The same shots, before and after:

| On screen | Rejected: captions the picture | Kept: argues a position |
|---|---|---|
| A door opens on the title "Not every home is accepted." | Not every home is accepted. | Every home has a price. |
| The camera goes through the doorway | Agents and owners bring homes to us. | It's rarely the interesting part. |
| A frame squares up on the chosen house | What we accept, we frame. | We're not brokers. We're editors. |
| The photograph becomes a page | We publish it as a feature. | A listing waits to be found. |
| California, New York, Florida | Three markets. California. New York. Florida. | Even our map is edited. |
| The title "Price never equals merit." | Price never equals merit. | It was never a matter of price. |
| The logo: Matter of Place | Matter of Place. | It's a matter of place. |

So:

- **The picture shows; the voice means.** Never say what the viewer can already read or see. Test each line with the picture running in your head: if deleting the line loses nothing, delete it. A paraphrase of the words on screen at that moment fails this test as surely as a repeat does. A line may pick up one word from a title when it turns it: the reference says "never" as that word drops into the title, in a sentence of its own. Words from an earlier shot are no longer being read, so echoing one later is fine.
- **Write an argument, not a tour.** One thought develops across the film: it opens on a tension ("Every home has a price. It's rarely the interesting part."), turns in the middle ("We're not brokers. We're editors."), and closes on the name.
- **Take the brand's side.** What it refuses, what it believes, who it is not. A stance is more interesting than a feature. A line about what the rest of the category does is your claim, not the brand's, unless the brief makes it: keep such lines few and list each one for confirmation.
- **Leave the facts to the screen.** Prices, place names, channels and product names are already being shown. The voice carries what the picture leaves out: the brand's conditions, refusals and reasons, as the brief gives them. If the brief gives facts and no reasons, do not supply reasons of your own; state the off-screen facts that show a stance.
- **Invent nothing.** Every line must trace back to the brief. No results, no numbers the brief does not give, no promises the brand does not make. Anything that is your wording rather than theirs gets listed for them to confirm.
- **Tone comes from the brief.** The reference brand's voice was calm and dry, so its wit lives in the words and the read is underplayed. A brief that asks for warmth gets warmth. Either way the read is level: the words do the work.
- **The last line carries the name.** Wordplay with the name belongs there, once, when the name has a second meaning the brand would claim itself. If you would have to explain it, it is not there. Then the last line is the name plus what the argument has earned, in a plain sentence: a bicycle restorer whose film argued that it never quotes blind ends on "Halden Cycles won't guess."

The table shows a method, not phrasing to reuse. A new script that borrows its sentence shapes ("We're not X. We're Y.") has copied the reference instead of listening to the new brand.

**When the request is to "explain" the brand**, the picture is usually already doing the explaining, and a voice that explains it again is the rejected script above. Write the argument, and say so in your first sentence: the voice argues the position behind what the picture shows. Two safeguards. What the brand is or does must reach the viewer once. The test: would someone who has never heard of the brand, watching with the sound off, know what it makes or does? If not, the voice says it, plainly, within its first two lines. And the facts from the brief that end up neither on screen nor in the script go in a "Left out" line, so the person can ask for any of them back.

## Fit it to the film

Get the timeline first: every shot's start time, what is on screen during it including titles, and the times of the musical accents. For a film made with the brand-film skill this is its shot list and timeline constants. Otherwise pull a contact sheet from the video, sixty frames spread over its length with the time in seconds on each, and read it:

```bash
D=$(ffprobe -v error -show_entries format=duration -of csv=p=0 film.mp4); ffmpeg -hide_banner -loglevel error -y -i film.mp4 -vf "fps=60/$D,scale=480:-1,drawtext=text='%{pts}':x=8:y=8:fontsize=20:fontcolor=white:box=1:boxcolor=black@0.6,tile=6x10" -frames:v 1 sheet.jpg
```

If the accents are not given, assume one on each cut and say that you did. With only a written shot list and no film, the moments inside a shot are unknown. Then do not build a line on exact sync: cue it by the cut rule, name the word and its event in the sync note, say that the time is to be set against the film, and offer to do that.

**Work out the last line's window before writing anything.** It opens 0.3 s after the final musical hit and closes half a second before the film ends. That is often under two seconds, which is five words at most, and it constrains the ending more than anything else. If it is too short for any line, say the name in the line before and let the logo play in silence.

Then write to these limits:

- **Words.** At most about two words per second of film, and fewer is better: 60 for 30 seconds, 40 for 20, 16 for 8. Films cut into short shots take fewer still, because each shot holds one short line. A contraction is one word; numbers are written and counted as they are spoken.
- **Lines.** Three to seven words per cue. One idea each. Two short sentences can share a cue when the second answers the first.
- **Cues.** Each line gets an "In" time. A line that belongs to a cut starts 0.3 to 0.6 s after it, so the picture lands first; the first line counts from 0:00. A line that belongs to something happening inside a shot starts with that event, which is why most cues in the reference sit later in their shots. A line that completes or answers a full title waits about a second, so the title is read first; small labels are read in passing and need no wait. In a shot too short to wait, write a line that does not lean on the title. A sync word can pull its line's cue anywhere it needs.
- **Fit.** Estimate each line's read time: 0.3 s a word and never less than 1.2 s, then add 0.4 s for each full stop or question mark inside the line (the one that ends it does not count), 0.2 s for each comma, and 0.1 s for each word of three syllables or more. The line fits when its end plus a 0.3 s breath comes before the next cue. Real reads run a few tenths either way and the breath is there to absorb that, so a line with nothing to spare beyond it is allowed, and is the first to check when the voice arrives. The last line needs no breath; it must end inside its window.
- **Sync words.** Pick one or two words that should land on a visual event (a frame snapping square, a word dropping into a title). A word lands when it starts as the event happens. Give the instruction with the event's time: `"editors" lands as the frame squares up at 0:11.5`. Set the line's cue so the estimate puts the word there: In, plus the read time of the words before it by the fit rule. On paper that is good to about a third of a second. The real time comes from the recording, and the clip is nudged then.
- **Music.** Do not start a line within 0.2 s of a musical hit, unless a sync word pulls its cue there. Where there is room, begin about 0.3 s after it. A line may run across a hit; the mix deals with that.
- **Silence.** At least a third of the film has no voice, counting only the lines' read times as voice. Leave at least one whole shot without voice, usually the one with the strongest change in the picture, and say which.

Before delivering, check with arithmetic, not by eye: total words; each line's estimated end plus breath against the next cue; the last line against its window; the share of the film with no voice. Check that no line repeats three or more consecutive words that appear on screen anywhere in the film. The one exception is the brand's name spoken over the logo. Then run the delete test on every line once more. Alternate lines must pass the same checks, and still make sense beside their neighbours.

If something in the film looks inconsistent while you work (a label that disagrees with its picture), say so in one sentence under "To confirm". Do not write around it silently, and do not lean a line on the doubtful element.

## What to deliver

In the reply, not as a file, unless a file is asked for. Keep everything outside the table to about 350 words, or up to about 450 when there was no film to look at or the brief asked for an explanation: the script is short and its wrapping should be too.

1. One or two sentences: the argument the script makes, its word count and seconds of speech (the sum of the lines' read times).
2. The script as a table: **In | On screen | Voice-over**. Include the silent shots, with their start time and "no voice", so every shot is accounted for.
3. **How to read it**, four short notes: tone, sync (the words that must land, on what, and when), silence (where the voice stays out), last line.
4. **Two swaps**: alternate wordings for the two lines most likely to be questioned, each labelled with what it changes ("more explicit", "warmer").
5. **To confirm**: each stance that is your wording, quoted beside the phrase in the brief it comes from; any line about the category; a plain statement that nothing claims a result and that any number spoken is the brief's own. Then the **Left out** line, when facts from the brief appear neither on screen nor in the script.
6. **Getting the voice made**, two or three sentences (below).
7. One closing offer, in plain words: to clean the recorded voice and mix it into the film with the music lowered under each line.

The reference script (58 words, 18.6 seconds of speech as recorded, for a 30-second film):

| In | On screen | Voice-over |
|---|---|---|
| 0:00.6 | The door opens: "Not every home is accepted." | Every home has a price. |
| 0:02.5 | Through the doorway | It's rarely the interesting part. |
| 0:05.3 | Rising over the submissions | A modest house can make the cut. |
| 0:07.7 | The declined homes sink | A grand one might not. |
| 0:09.6 | The frame squares up on the chosen house | We're not brokers. We're editors. |
| 0:12.5 | The photograph becomes a page | A listing waits to be found. |
| 0:15.3 | Cards go out at nightfall | A feature travels. |
| 0:18.0 | California, then New York | Even our map is edited. |
| 0:20.2 | Florida | no voice |
| 0:22.5 | Four packages and their prices | Acceptance is not for sale. |
| 0:25.0 | "Price never equals merit." | It was never a matter of price. |
| 0:28.0 | Logo | It's a matter of place. |

Its notes read: *Tone: dry and level, with the wit left in the words; underplay every line. Sync: "editors" lands as the frame squares up at 0:11.5, "never" at about 0:25.4 as the word drops into the title. Silence: Florida plays with no voice, and there is a beat before each second sentence. Last line: it is the name, so read it plainly as the wordmark settles.*

Three things to know about it. Line 5 starts 0.15 s before its cut, on top of that cut's hit, so that "editors" arrives on its moment: the sync word pulled the cue. In the recording "editors" started at 0:11.45 and "never" at 0:25.35, each within a tenth of a second of its event. The paper estimates were a quarter of a second out for both, one early and one late: estimates are estimates. And its last line starts at 0:28.0, a tenth of a second after the film's final chord, so the mix had to pull the chord down almost as it landed. Where the film allows, give a closing hit 0.3 s to itself.

## If a spreadsheet is asked for

Use a spreadsheet skill if one is available and build four tabs: **Script** (#, In as a time value, On screen, Voice-over, Words and Seconds until next line as formulas, an "End of film" row and a total), **How to read it**, **Swaps** (the current wording pulled from the Script tab by formula, beside the alternative), **To confirm**. Say in a note under the table which cells are typed by hand and which are calculated.

## Getting the voice made

Tell the person, briefly, what makes the next step easy:

- **Read or generated, the delivery is the same**: level, unhurried, no lift at the ends of lines, every full stop a real pause.
- **A generated voice** should be made one line per clip and exported as WAV, the takes chosen by ear. Then lay the clips on a timeline as long as the film, each starting at its "In" time, slide a clip a little if its sync word is early or late, and export a single file the length of the film. A file laid out like that keeps its timing through the mix untouched.
- **A recorded voice** wants a quiet, soft-furnished room, the microphone a hand's width away, levels short of the red, a few seconds of silence at the start, and no filters applied by the recording app.

You cannot listen to audio, so never say a take "sounds good". The choice of take is theirs.
