# Evidence for "Where Online Video Content is Headed"

Research notes for `thoughts/draftinternetvideos.html`, organized by the draft's subsections. The draft has not been edited.

**Strength tags**
- **[strong]**: peer-reviewed, decent sample, or a primary source for a shipped product
- **[moderate]**: peer-reviewed but small or correlational, or solid journalism
- **[weak]**: blog, anecdote, or a single small study
- **[company claim]**: numbers from the vendor, not independently checked
- **⚠ verify**: I only saw the abstract or secondary coverage, so check the figures before quoting them

---

## 0. The premise: "everyone will be watching slightly different versions of the same video"

This already happens for packaging (thumbnails, titles, audio language). The next step, editing the video itself per viewer, has a published research blueprint and several shipped precursors.

- **Netflix, "The Power of a Picture"**: artwork took up more than 82% of members' focus while browsing. Faces showing complex emotions outperformed stoic ones, and images with more than three people did worse. This supports your thumbnail caption ("The facial expressions!"). [strong, company research] https://about.netflix.com/news/the-power-of-a-picture
  - Secondary coverage says villain images beat hero images. I couldn't confirm that in Netflix's own text. ⚠ verify
- **YouTube Test & Compare**: thumbnail A/B testing launched in 2024 and title testing in 2025. Creators upload up to 3 variants, different viewers see different ones, and the winner is picked by watch-time share. This is your "A/B/.../Z" point at A/B/C today. [strong] https://www.tubefilter.com/2025/07/16/youtube-feature-test-and-compare-titles-thumbnails/
- **YouTube auto-dubbing with "expressive speech"** (built with DeepMind): carries the creator's pitch, intonation and energy into other languages. A lip-sync pilot makes "pixel-level changes" to the speaker's mouth. Viewers in different countries already hear and see different versions of the same video. [strong] https://tech.slator.com/youtube-multilingual-expressive-speech-ai-dubbing/ and https://ppc.land/youtube-auto-dubbing-tops-6m-daily-viewers-expands-to-27-languages
- **Meta AI translations for Reels** (Aug 2025): dubs creators in their own cloned voice, with optional lip sync, and adds a small "AI-translated" label. [strong] https://businesstoday.in/technology/news/story/meta-ai-can-clone-your-voice-in-another-language-heres-how-it-works-490263-2025-08-20
- **YouTube already alters uploaded pixels.** In Aug 2025 creators (Rick Beato, Rhett Shull) found YouTube running ML sharpening and smoothing on Shorts without telling them. YouTube confirmed it. Shull only caught it by comparing his original file with the playback. Then in Oct 2025 YouTube announced AI "super resolution" upscaling, on by default with a creator opt-out. Both are precedents for platform-side edits that the uploader didn't make. [strong]
  - https://www.eweek.com/news/youtube-ai-video-enhancement-without-consent/
  - https://www.computing.co.uk/news/2025/ai/youtube-secretly-uses-ai-to-alter-creators-videos-without-consent
  - https://9to5google.com/2025/10/29/youtube-adds-ai-upscaled-super-resolution-for-low-quality-videos/
- **GeneRec** (Wang, Lin, Feng, He, Chua 2023): an academic blueprint for your whole section. It proposes replacing "retrieve the best video" recommenders with an "AI editor" that repurposes existing micro-videos per user and an "AI creator" that generates new ones. Their demo makes personalized thumbnails (frame selection plus diffusion-generated) that match a user's past likes better than the original thumbnail does. [moderate] https://arxiv.org/abs/2304.03516
  - Follow-up (Jul 2026): "What Would You Click? Personalized Video Thumbnail Generation with Preference-aware Highlight Retrieval." ⚠ verify, I only saw the listing. https://arxiv.org/abs/2607.12882
- **Cadbury "#NotJustACadburyAd"** (India, 2021, built with Rephrase.ai): AI regenerated Shah Rukh Khan's face and voice so he names a different local shop for each viewer's pin code. It's the clearest real case of a celebrity saying different things to different viewers. [moderate, agency case study] https://www.wpp.com/en/case-studies/ogilvy-and-wavemaker-notjustacadburyad

---

## 1. Colors

### How hard is it?

**Easy, and getting easier.** There are three levels:

1. **Global grade** (saturation, warmth, contrast, exposure): trivial, real-time, and done on every phone. It's essentially free.
2. **Object-level recolor** (one shirt, one car, hair, eyes): the hard part is masking the object across frames, and that's now solved.
   - **Meta SAM 2** (2024, open source, Apache 2.0) tracks any object from a single click across a whole video at about 44 fps. [strong] https://www.datacamp.com/blog/sam2-meta-segment-anything-model
   - **ModiFace / L'Oréal** has done real-time hair recoloring on live phone video since 2018. It was trained on 220k annotated hair images and tracks strands as the head moves. If hair color can be changed live on a phone, it can be changed offline on a server. [strong] https://developer.nvidia.com/blog/3d-real-time-video-hair-coloration
3. **Generative video-to-video editing**:
   - **Runway Aleph** (Jul 2025, available to all paid users) adds, removes and transforms objects and changes style and lighting in existing footage from a text prompt. [strong] https://runwayml.com/research/introducing-runway-aleph
   - Research versions: **VidStyleODE** does temporally consistent text-guided color and garment edits (https://arxiv.org/abs/2304.06020). **ViViD** and **3DV-TON** do diffusion video try-on, i.e. clothing swaps (https://arxiv.org/abs/2405.11794, https://arxiv.org/abs/2504.17414). [moderate]

### Does it affect the viewer?

Yes. More saturation and brightness raise arousal, people prefer images somewhat more colorful than reality, filters raise engagement, and the best enhancement differs by person.

- **Wilms & Oberfeld 2018** (*Psychological Research*, n=62): saturated, bright colors raised both arousal and pleasantness ratings. They also produced stronger skin-conductance responses, and chromatic colors sped up heart rate. The effect comes from saturation and brightness as much as hue. [strong]
  - https://pubmed.ncbi.nlm.nih.gov/28612080/
  - PDF: https://www.staff.uni-mainz.de/oberfeld/downloads/Wilms-Oberfeld2018_Article_ColorAndEmotionEffectsOfHueSat.pdf
- **Fedorovskaya, de Ridder & Blommaert** (1990s, Eindhoven): viewers generally preferred a more colorful version over the original, even when it looked "somewhat unnatural." Hue shifts hurt quality ratings much more than chroma boosts did. This is almost exactly your "shine brighter without tipping off" claim: boosting chroma is safe, shifting hue isn't. [moderate, small panels]
  - https://research.tue.nl/en/publications/perceptual-quality-of-color-images-of-natural-scenes-transformed-/
  - https://research.tue.nl/en/publications/naturalness-and-image-quality-chroma-and-hue-variation-in-color-i/
- **Bakhshi, Shamma, Kennedy & Gilbert 2015** (ICWSM, 7.6M Flickr photos): filtered photos were 21% more likely to be viewed and 45% more likely to be commented on. Filters that raise **warmth, exposure and contrast** helped most. [moderate: correlational, and the authors worked at Yahoo, which owned Flickr] https://ojs.aaai.org/index.php/ICWSM/article/view/14622
  - **2019 follow-up** (4.9M images): it depends on content. Food and people photos did better filtered, while landscapes and night shots did better unfiltered. That argues for per-content tuning rather than one global filter, which is your thesis. https://ojs.aaai.org/index.php/ICWSM/article/view/3211
- **Personalized enhancement is an established research line:**
  - Kang, Kapoor & Lischinski, CVPR 2010: people's enhancement preferences differ, and personalized enhancement beats generic auto-enhance. [moderate] https://www.microsoft.com/en-us/research/wp-content/uploads/2016/12/PersonalizedEnhancement-CVPR2010.pdf
  - Caicedo, Kapoor & Kang, CVPR 2011: collaborative-filtering version, 336 users. https://mlanthology.org/cvpr/2011/caicedo2011cvpr-collaborative
  - **PieNet** (ECCV 2020): a user picks 10–20 images they like, and the network learns a "preference vector" and enhances new images to that person's taste. It outperforms generic enhancement. This is a working version of "learn this user's color taste." [moderate] https://www.ecva.net/papers/eccv_2020/papers_ECCV/html/7579_ECCV_2020_paper.php
- **Noticeability, from change blindness:** Levin & Simons 1997 (*Psychonomic Bulletin & Review* 4:501–506). Across a film cut, the sole actor in a scene was swapped for a different person, different clothes included, and about two-thirds of viewers didn't notice. Personalized recoloring is even harder to catch, because no viewer ever sees the other version. [strong, classic]
  - Real-world follow-up, where about half of pedestrians missed a person swap: https://experts.illinois.edu/en/publications/failure-to-detect-changes-to-people-during-a-real-world-interacti/
- **Analogy, TV "vivid" showroom mode:** retailers and manufacturers crank brightness and saturation because shoppers pick the brightest set as the "clearest." [weak, journalism]
  - https://www.nbcnews.com/id/wbna41609942
  - TP Vision's 2025 usage data says most owners keep non-accurate "enhanced" presets: https://hdtelevizija.com/en/2025/04/06/consumers-still-watching-sdr-and-preferring-enhanced-picture-modes-insights-from-tp-vision-2025/

### No good evidence found

- **Thumbnail or video color → views on YouTube or TikTok.** There are lots of SEO blogs and no solid study. The closest is a LessWrong post that ran a sparse autoencoder on YouTube-8M thumbnails and found high-view thumbnails use a warmer palette. The author flags confounds such as upload date. [weak] https://www.lesswrong.com/posts/WvoexzXwnneXrRyea/food-prison-and-exotic-animals-sparse-autoencoders-detect-6
  - YouTube has auto-picked thumbnail frames with a neural net since 2015: https://research.google/blog/improving-youtube-video-thumbnails-with-deep-neural-nets/
- **HDR being exploited on purpose to stand out in feeds.** It's widely observed that HDR clips on Instagram and TikTok push phone screens to max brightness and look brighter than everything around them. Everything I found says it's mostly accidental, and nothing shows it raises engagement.

### Suggested additions

- **Warmth and contrast specifically**, not just "brighter." The Flickr data points at warmth, exposure and contrast, not raw saturation.
- **Chroma up, hue untouched.** The Eindhoven work suggests the undetectable move is boosting saturation while keeping hues where they are. Shifting a known color, like a red car turning blue, is riskier.
- **Per-content grading.** Food gets punchier, landscapes stay natural (the 2019 follow-up).
- **HDR / display brightness** as a separate lever from color grading: literally making one video brighter than the rest of the feed.
- **Thumbnails will be personalized first**, because they're cheap and already A/B-tested (GeneRec, Test & Compare).
- **Skin tone grading** connects to Appearances (see carotenoid skin color below).

---

## 2. Voices

### Signal space (tone, pitch, intonation, volume): technically here already

- **Volume already changes automatically:**
  - **YouTube Stable Volume** has been on by default since 2023 (mobile, then TV in 2024). It continuously evens out the loud and quiet parts of a video. [strong] https://9to5google.com/2024/06/24/youtube-stable-volume/
  - **Amazon Prime Video Dialogue Boost** (2023): AI isolates dialogue and raises it above music and effects, and your chosen level is remembered. [strong] https://www.soundandvision.com/content/amazon-prime-video-using-ai-dialogue-boost-originals
- **Editing the words in a real recording:** **VoiceCraft** (ACL 2024) regenerates only the changed words in existing speech. Listeners preferred the edited clip over the real, unedited recording 48% of the time, so the two are effectively indistinguishable. Fun detail: one of the co-authors is Rembrand, the AI product-placement company from the Ads section. [strong] https://arxiv.org/abs/2403.16973
- **Voice clones fool people:** Lavan et al. 2025 (*PLOS One*). Clones built with off-the-shelf ElevenLabs from under 5 minutes of audio were judged human 58% of the time, versus 62% for real voices, which is no significant difference. AI voices were rated **more dominant**, and some were rated **more trustworthy**. Unlike faces, there was no "hyperreal" effect: clones weren't rated *more* human than real voices. [strong] https://pmc.ncbi.nlm.nih.gov/articles/PMC12459763/
- **Real-time accent conversion** is a shipped product: **Sanas** changes call-center agents' accents live. It claims 35k+ agents use it and that attrition dropped (company claims). Critics call it "white voice." [moderate]
  - https://nearshoreamericas.com/accent-software-thrives-despite-being-labelled-racist/
  - https://studyofhate.ucla.edu/sanass-ai-white-voice-automated-accent-neutralization-for-call-center-workers/

### Do voice changes affect the listener?

- **Van Zant & Berger** (*JPSP*, online 2019): speakers who modulate their voice, especially speaking louder and varying volume, are more persuasive because they sound more confident. It works **even when listeners notice** the attempt. [strong] https://faculty.wharton.upenn.edu/wp-content/uploads/2019/01/Voice-Persuades.pdf
- **Speech rate:** Miller et al. 1976 (*JPSP* 34:615–624) found faster speech (about 195 vs 102 wpm) more credible and persuasive. Later work says it depends on how invested the listener is, and fast speech can reduce how carefully they weigh arguments. [moderate]
  - Guo, Kim & Rubin 2014 (6.9M edX sessions): students engaged more with faster-speaking instructors and with shorter videos. [strong] https://up.csail.mit.edu/other-pubs/las2014-pguo-engagement.pdf
- **Pitch:** Feinberg et al. 2005 (*Animal Behaviour*): women rated digitally lowered male voices as more attractive than raised ones. [strong] https://research-portal.st-andrews.ac.uk/en/publications/manipulations-of-fundamental-and-formant-frequencies-influence-th/
- **Averaging, with a caution:** Bruckert et al. 2010 (*Current Biology*) found that averaged, morphed voices were rated more attractive (https://eprints.gla.ac.uk/32840). **A 2024 replication found no effect** (*Scientific Reports*): https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11076608/. I wouldn't lean on it.
- **Preferences are personal, which supports personalization:** Bruder, Frieler & Larrouy-Maestri 2024 (*Royal Society Open Science*, preregistered): appreciation of singing and speaking voices is "highly idiosyncratic." There's no single best voice, so per-viewer tuning has room to work. [strong] https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11537763/
- **Similarity-attraction:** Nass & Lee 2001 (*J. Exp. Psych: Applied*). Extroverts preferred a synthetic voice that sounded extroverted (louder, faster), and introverts preferred an introverted one. They liked the reviews read in that voice more too. People like voices that sound like them. [moderate, one later null] https://sciencedaily.com/releases/2001/10/011001072153.htm
- **"YouTube voice" is a documented phenomenon.** The Atlantic (2015) asked linguist Naomi Baron about it. She pointed to overstressed and lengthened vowels and extra aspiration: ordinary emphasis devices pushed hard to hold attention when it's just a face talking to a camera. Linguists think it spread by imitating successful creators. This is a good companion to your Reddit link. [news]
  - https://marketplace.org/2015/12/22/youtube-voice-linguistics-behind-phenomenon
  - https://vice.com/en/article/the-rise-of-youtube-voice-and-why-vloggers-want-it-to-stop

### Structure (LLM speak, word level): strong evidence it's already happening

- **Yakura et al.** (Max Planck, arXiv 2024, updated 2025): about 280k English YouTube videos of talks from 20k+ academic channels. ChatGPT-favored words ("delve," "meticulous," "realm," etc.) rose significantly in *spoken* language after ChatGPT's release, some by 25–50% a year. Podcasts showed it too. A preregistered experiment (N=496) also showed people pick up chatbot wording after short interactions. [strong] https://arxiv.org/abs/2409.01754
- **Juzek et al.** (AIES 2025): 22M words of **unscripted** conversational podcasts, so not AI-written scripts. AI-associated words ("surpass," "meticulous," "strategically," "intricate") rose while their synonyms barely moved. The authors stress this is correlational. [moderate] https://arxiv.org/pdf/2508.00238
- **Your parenthetical about model styles disappearing may be wrong.** Sun et al. (ICML 2025): a classifier can tell ChatGPT, Claude, Grok, Gemini and DeepSeek text apart with **97.1% accuracy**. The fingerprint survives rewriting, translation and summarization. Humans may stop *noticing* the styles, but the styles are stable and machine-detectable. You could rephrase as "...though people will stop noticing them." [strong] https://arxiv.org/abs/2502.12150

### Verbiage scaled to the viewer

- **Simpler wording gets more engagement:** Shulman, Markowitz & Rogers 2024, "Reading dies in complexity: Online news consumers prefer simple writing" (*Science Advances* 10:adn2555), based on news-headline A/B tests. ⚠ verify, I couldn't access the full text or effect sizes. https://doi.org/10.1126/sciadv.adn2555
- **Oppenheimer 2006** (*Applied Cognitive Psychology*, Ig Nobel winner): needlessly long words made writers seem *less* intelligent. [moderate] https://www.dailyprincetonian.com/article/2006/10/on-erudite-vernacular-i-e-big-words
- **LLMs can rewrite to a target reading level, imperfectly:**
  - Grade-specific simplification (Agrawal & Carpuat, EMNLP 2023): https://arxiv.org/abs/2305.14993
  - ReadCtrl 2024: https://arxiv.org/abs/2406.09205
  - A Stanford evaluation found hitting a grade level is "variable" at 4th grade: https://scale.stanford.edu/ai/repository/evaluating-genai-simplifying-texts-education-improving-accuracy-and-consistency
  - Gap: very few tests with real readers of specific ages. [moderate]
- **Tailoring words to the person works, and this is the strongest evidence for your point:**
  - **Matz et al. 2024** (*Scientific Reports*, N=1,788): ChatGPT messages matched to a person's personality, politics or moral values were more persuasive than generic ones. That held for ads and political appeals, even when the model was given only one line about the target. [strong] https://pmc.ncbi.nlm.nih.gov/articles/PMC10897294
  - **Salvi et al. 2025** (*Nature Human Behaviour*, N=900, preregistered): GPT-4 given basic demographics had **81.2% higher odds** of changing someone's opinion than a human debater. [strong] https://www.psypost.org/scientists-demonstrate-that-ais-superhuman-persuasiveness-is-already-a-reality/

### No good evidence found

- No study shows that AI-"pleasantened" creator voices raise watch time or engagement on a real platform. All the evidence is lab-based (persuasion, attractiveness, trust).

### Suggested additions

- **Accent and dialect matching:** the creator sounds slightly more like *you*, by region or class. Sanas proves the tech, and Nass & Lee plus similarity-attraction give the motive.
- **Language** is the biggest voice personalization already shipping: YouTube and Meta dub creators in their own voice, lip-synced.
- **Speech rate and silence trimming:** see Order. Overcast's Smart Speed and Pocket Casts' Trim Silence already cut silences automatically.
- **Personality matching:** louder and faster for extroverted viewers, calmer for introverted ones (Nass & Lee).
- **Background music and sound design** tuned to the viewer's music taste.

---

## 3. Appearances

### Feasibility

- **Leyvand, Cohen-Or, Dror & Lischinski, SIGGRAPH 2008, "Data-driven enhancement of facial attractiveness":** a model trained on human ratings warps facial landmarks toward a nearby, higher-rated face while keeping a close resemblance to the original. Independent raters judged most results more attractive. This is the 2008 academic version of your before/after portrait. [strong] https://cris.huji.ac.il/en/publications/data-driven-enhancement-of-facial-attractiveness-13/
- **MARZ "Vanity AI"** (2023): AI "digital makeup," de-aging and cosmetic fixes for TV and film. MARZ says it cuts a 5-second shot from about 16 artist-hours to minutes and has been used on 27+ productions, including *Stranger Things* S4. "Beauty work" is already routine in professional video. [company claim] https://www.businesswire.com/news/home/20230119005265/en/MARZ-Unveils-Vanity-AI-VFX-Solution-for-Hollywood
- **Real-time eye-contact correction** is shipping: Apple FaceTime "Attention Correction" (iOS 13, 2019) and NVIDIA Broadcast "Eye Contact" (2023) redraw your eyes to look at the camera. Zoom's "touch up my appearance" smooths skin. [strong]
  - https://www.deeplearning.ai/the-batch/then-their-eyes-locked-not
  - https://voicebot.ai/2023/01/16/nvidia-deploys-deepfake-eye-contact-feature-for-video-streaming/
- **AI faces pass as real and are trusted more:** Nightingale & Farid 2022 (*PNAS*). People told GAN faces from real ones at 48% accuracy, essentially chance, and rated the synthetic faces **7.7% more trustworthy**. Farid's guess is that GAN faces look more "average." [strong] https://pmc.ncbi.nlm.nih.gov/articles/PMC8872790
- **Köbis et al. 2021** (*iScience*), "Fooled twice: People cannot detect deepfakes but think they can." The title says it. ⚠ verify, I didn't read the full text. https://hdl.handle.net/21.11116/0000-0009-804B-2

### Effects on viewers

- **Gulati et al. 2024**, "What is beautiful is still good: the attractiveness halo effect in the era of beauty filters" (*Royal Society Open Science*). 2,748 raters judged 462 people, each shown original and beauty-filtered. The filtered versions were rated more attractive and **also more intelligent and trustworthy**. This directly supports "slightly hotter/prettier/friendlier." [strong] https://pmc.ncbi.nlm.nih.gov/articles/PMC11597472/
- **Skin color:** Stephen, Coetzee & Perrett (*Evolution and Human Behavior* 2011, plus a 2009 paper). Asked to make faces look healthier, people raised skin **yellowness (carotenoid, from fruit and vegetable intake) and redness**, and preferred that over suntan coloring. This refines your "tanner" claim: the winning edit is more golden and rosy than tanned. [strong]
  - https://research-portal.st-andrews.ac.uk/en/publications/carotenoid-and-melanin-pigment-coloration-affect-perceived-human-/
  - https://research-repository.st-andrews.ac.uk/handle/10023/3432
- **Pupils:** Hess 1965, "Attitude and Pupil Size" (*Scientific American* 212(4):46–54). Men preferred a photo of a woman retouched to have larger pupils **without noticing the difference**. It's a classic unnoticed edit. Replication is mixed, e.g. Janisse 1974: https://www.sbp-journal.com/index.php/sbp/article/view/66 [moderate]
- **Attractiveness is half personal, so personalization has headroom beyond a global beauty filter:**
  - Hönekopp 2006 (*JEP: Human Perception & Performance*): private taste counts about as much as shared taste in judging facial attractiveness. [strong] https://researchportal.northumbria.ac.uk/en/publications/once-more-is-beauty-in-the-eye-of-the-beholder-relative-contribut/
  - Germine et al. 2015 (*Current Biology*, about 35k people including twins): two random people agree only about **48%** on which faces are attractive. Individual face preferences are shaped mostly by personal environment, not genes. [strong] https://www.ocf.berkeley.edu/~knakayama/wp-content/uploads/2019/03/185Germine2015.pdf
- **AI already generates faces tuned to one viewer:** Spapé et al. 2021 (*IEEE Transactions on Affective Computing*, n=30). A GAN steered only by each person's EEG responses (no clicks) generated faces that person found attractive, confirmed in double-blind tests. It's a proof of concept for "learn what this viewer finds hot and render it." [moderate]
  - https://ieeexplore.ieee.org/document/9353984/
  - https://www.helsinki.fi/en/news/technology/beauty-brain-beholder-ai-generates-personally-attractive-images-reading-brain-data
- **Looking like the viewer creates trust:**
  - **Bailenson, Iyengar, Yee & Collins 2008** (*Public Opinion Quarterly*): candidates' photos were subtly morphed with each voter's own face. Voters favored the candidate who resembled them, and **no one noticed** the morph. Earlier work had found a 40% blend too subtle to spot. [strong] https://vhil.stanford.edu/publications/vr-law/facial-similarity-between-voters-and-candidates-causes-influence
  - DeBruine 2002 (*Proc. R. Soc. B*): faces morphed toward the participant's own were trusted more in a trust game. A later study didn't replicate it. [moderate] https://pmc.ncbi.nlm.nih.gov/articles/PMC1691034

### Platform incentives, including "closer to porn"

- **The Intercept 2020:** internal TikTok guidelines told moderators to keep posts from users with "ugly facial looks," "abnormal body shape," and the like, and videos shot in "shabby and dilapidated" homes, out of the For You feed. The stated reason was to retain new users. Platforms already optimize on appearance. [strong, leaked documents] https://theintercept.com/2020/03/16/tiktok-app-moderators-users-discrimination/
- **AlgorithmWatch 2020, "Undress or fail":** in volunteers' Instagram feeds, posts showing women in bikinis or underwear were **54% more likely** to appear, and bare-chested men 28%. The sample is small (26 volunteers, 2,400 posts), and Facebook later shut the project down. [moderate] https://algorithmwatch.org/en/instagram-algorithm-nudity/

### Counter-evidence and nuance

- **"Beauty backfire":** Edelblum & Frank (*Psychology & Marketing*, 2025). *Highly* attractive fitness influencers got **less** engagement than moderately attractive ones because they felt less relatable. Humility helped, and the effect was weaker for finance influencers. This **supports** your "slightly hotter, without it being too noticeable" framing, since the optimum is below maximum. [moderate, experiments with mock posts] https://www.psypost.org/too-attractive-to-relate-study-suggests-extreme-beauty-may-backfire-for-fitness-influencers/
- **Live commerce:** one 2023 conference paper (2,597 Douyin clips) found a *negative* relation between streamers' beauty and sales, except for hedonic products. [weak] https://eudl.eu/doi/10.4108/eai.1-9-2023.2338739
- **Harms:** "Snapchat dysmorphia" (Vashi et al., *JAMA Facial Plastic Surgery* 2018) describes patients wanting surgery to look like their filtered selves. An AAFPRS survey found 55% of surgeons had seen patients who wanted to look better in selfies. [moderate]
  - https://fortune.com/2018/08/03/please-dont-ask-a-plastic-surgeon-to-make-you-look-like-a-snapchat-filter
  - https://psychnews.psychiatryonline.org/doi/10.1176/appi.pn.2018.11a11

### No good evidence found

- No good study links a real creator's attractiveness to views or followers. The evidence is thin and mixed (see beauty backfire).
- No causal study of beauty filters' effect on streamer revenue.

### Suggested additions

- **Self-resemblance morphing** is the most striking one, and it's backed by evidence (Bailenson). The creator's face drifts slightly toward *your* face, or your partner's, and you trust them more without noticing.
- **Eye contact:** the creator always looks *at you*. It's already shipping.
- **Expressions:** smiles, eyebrow flashes and "complex emotion" faces (Netflix), and pupils (Hess).
- **Sets and backgrounds:** TikTok literally suppressed "shabby" rooms, so expect rooms to be tidied and upgraded.
- **Optimal, not maximal** attractiveness, tuned per viewer and per niche (beauty backfire).

---

## 4. Order

### Already shipping

- **YouTube Jump Ahead** (already cited), plus YouTube's **"Most replayed"** heatmap.
- **Netflix "Skip Intro":** pressed about **136 million times a day**, saving 195 years of viewing time daily (Netflix, about 2022). It started because Netflix saw viewers manually skipping ahead in the first five minutes about 15% of the time. [strong] https://www.tvbeurope.com/media-consumption/netflixs-skip-intro-button-is-pressed-136-million-times-a-day
- **Amazon X-Ray Recaps** (Nov 2024): generative-AI summaries of the season so far, matched to your exact playback position. Skipping by summary instead of by section. [strong] https://techcrunch.com/2024/11/04/amazon-brings-generative-ai-powered-recaps-to-prime-video
- **Podcast "Smart Speed" / "Trim Silence"** (Overcast, Pocket Casts, Castro): silences are cut automatically, and users report hundreds of hours saved. It's automatic trimming of the boring parts, opt-in, exactly your "after enough yeses" step. [strong] https://tidbits.com/2014/07/16/overcast-refines-the-iphone-podcast-experience/
- **YouTube "Peak Points"** (Brandcast, May 2025): Gemini finds the most-engaging moment in a video to place an ad right after it. The platform already models a video's moment-by-moment structure. [strong] https://9to5google.com/2025/05/15/youtube-ads-gemini-peak-points-placement/

### Research on personalized cutting

- **PHD-GIFs** (Garcia del Molino & Gygli, ACM MM 2018): personalized highlight detection. One model conditioned on each user's history picks the segments *that user* wants, improving recall by 8% over generic highlight detection. [moderate] https://arxiv.org/abs/1804.06604
- **GeneRec** (above) proposes personalized micro-video clipping. https://arxiv.org/abs/2304.03516
- **Kim et al. 2014** (862 edX videos, second-by-second data): longer videos lose more viewers. Rewatch peaks mark the interesting or confusing parts, and 61% of peaks coincide with visual transitions. This is the kind of data an optimizer would use to reorder sections. [strong] https://www.eecs.harvard.edu/~kgajos/papers/2014/kim14video.pdf

### Creators already restructure for retention

- **MrBeast's leaked production handbook** (2024, confirmed by two former producers): the first minute is "crucial," with planned "re-engagement" beats around minutes 3 and 6. The team optimizes CTR, average view duration and average view percentage. [news]
  - https://passionfru.it/mrbeast-leaked-document-81151/
  - https://gigazine.net/gsc_news/en/20240917-mrbeast-youtube-production
- **Netflix "second-screen" notes** (Will Tavlin, "Casual Viewing," *n+1*, Dec 2024): screenwriters say Netflix asks for characters to announce what they're doing so viewers on their phones can follow. Content is already being restructured for distracted viewing. [news] https://www.tubefilter.com/2025/01/07/netflix-murder-mystery-casual-viewing-what-we-watched/

### The "race to the bottom" on length: good analogies

- **Pop-song intros:** Léveillé Gauvin 2018 (*Musicae Scientiae*, about 300 top-10 singles 1986–2015). Intros shrank from about 20 seconds to about 5, and vocals start sooner. He attributes it to the "attention economy" and streaming. It's the same trimming you predict, already measured in another medium. [strong]
  - https://pure.etsmtl.ca/en/publications/drawing-listener-attention-in-popular-music-testing-five-musical-/
  - https://prsformusic.com/m-magazine/news/streaming-making-pop-songs-faster-shorter-new-study-reveals
- **Film shot length:** Cutting et al. 2011, "Quicker, faster, darker" (160 films, 1935–2010). Shots have gotten steadily shorter, and the decline predates MTV. Cutting cites about 12 seconds in the 1930s versus about 2.5 today in interviews, though papers give different numbers. [strong] https://pmc.ncbi.nlm.nih.gov/articles/PMC3485803/
- **Speed-watching:** Murphy et al. (*Applied Cognitive Psychology* 2021/22, n=231). Lectures at 1.5–2× had minimal comprehension cost, with declines only beyond 2×. Viewers can already compress video, and many do. [strong] https://castel.psych.ucla.edu/wp-content/uploads/sites/111/2022/03/Applied-Cognitive-Psychology-2021-Murphy-Learning-in-double-time-The-effect-of-lecture-video-speed-on-immediate-and.pdf

### Counter-evidence worth addressing

- **YouTube long-form is not obviously shrinking.** The average video from popular channels was about 12 minutes in 2019 (Pew). In Feb 2025 YouTube said **TV screens overtook mobile** as the primary way people in the US watch YouTube. A Digital i analysis (via Señal News, 2026) says the share of viewing time on 20+ minute videos *rose*, from 63.6% to 67.7%, between Jan 2024 and Dec 2025. Living-room viewing may push long-form *longer*, not shorter, which is a good tension to acknowledge. ⚠ verify the Digital i numbers, I couldn't get a clean link.
  - https://www.pewresearch.org/internet/2019/07/25/popular-youtube-channels-produced-a-vast-amount-of-content-much-of-it-in-languages-other-than-english/
  - https://www.techspot.com/community/topics/youtube-is-the-new-television-more-people-now-watch-on-tv-than-mobile.290688/

### Suggested additions

- **Pacing as well as order:** cut frequency and tempo per viewer. Shot length is already falling, and Guo et al. found faster speakers more engaging.
- **Speed and silence trimming per viewer:** an automatic 1.25× for you, 1× for someone else.
- **Personalized hooks:** the first 3 seconds or first minute differ per viewer (MrBeast's first-minute obsession).
- **Recaps instead of watching:** X-Ray-style summaries replace whole sections or episodes.
- **Branching endings:** *Bandersnatch*-style, but chosen for you rather than by you. https://en.wikipedia.org/wiki/Black_Mirror:_Bandersnatch

---

## 5. Ads

### Already shipping

- **Amazon virtual product placement** (May 2022 NewFronts): products digitally inserted into *Bosch*, *Reacher*, *Jack Ryan*, *Making the Cut*, and others after filming, for example M&M's in a bowl on a *Bosch* desk. Amazon reported +6.9% favorability and +14.7% purchase intent for one unnamed brand. NBCU launched the same idea as "In-Scene Ads." [strong, with company-claimed results] https://techcrunch.com/2022/05/17/virtual-product-placement-ads-are-coming-to-amazon-prime-video-and-peacock/
- **Rembrand:** AI product placement in **creator** videos after shooting. It raised an $8M seed (2023) and a $23M Series A (Jan 2025, The Trade Desk participating). Creators get 75% of net revenue. Rembrand claims 250M paid views in 2024, with clients including PepsiCo, L'Oréal and Amazon. This is your "creators will overwhelmingly approve" economy, already running. [company claim]
  - https://www.maginative.com/article/rembrand-raises-23m-to-bring-virtual-product-placement-to-connected-tv/
  - https://voicebot.ai/2023/02/10/generative-ai-product-placement-startup-rembrand-raises-8m/
- **Netflix** (Upfront, May 2025): a generative-AI ad framework that will "instantly marry advertisers' ads with the worlds of our shows," rolling out to all ad-supported countries by 2026. [strong, primary source] https://about.netflix.com/news/netflix-upfront-2025-the-center-of-attention
- **YouTube Peak Points** (Gemini picks the ad slot; see Order) and **YouTube Shopping AI auto-tagging**: a product tag pops up at the moment a product is mentioned, and YouTube is testing automatic tagging of *every* eligible product in a video. [strong] https://blog.youtube/news-and-events/earn-more-with-brand-partnerships/
- **Podcast ads read in the host's cloned voice:** ekoz.ai with Triton Digital and Spreaker (Jul 2025). AI writes an ad script per host, voices it in the host's cloned voice (with the host's permission), and inserts it dynamically. A Google patent (US12106330) argues cloned-host reads are more persuasive than generic ones. [moderate]
  - https://soundsprofitable.com/press-release/triton-digital-partners-with-ekoz-ai-to-bring-ai-generated-host-read-podcast-ads-to-spreaker/
  - https://patents.google.com/patent/US12106330
- **TikTok Symphony custom avatars** (Jun 2024): creators can license an AI avatar of themselves for brand ads, auto-dubbed into 10+ languages, so ads they never filmed. [strong] https://techcrunch.com/2024/06/17/tiktok-ads-and-branded-content-will-now-include-ai-avatars-of-creators-and-stock-actors
- **Mirriad** (VPP vendor) and Kantar ran 20+ studies. One Toyota campaign claims 94% ad awareness. [company claim] https://www.kantar.com/uki/inspiration/advertising-media/placing-the-future
- **Analogy: ads inside AI answers.** OpenAI started testing ads in ChatGPT for US Free and Go users in early 2026, as sponsored products matched to the conversation. [news] https://siliconangle.com/2026/01/16/openai-start-testing-chatgpt-ads-across-free-go-tiers/

### "Users may not even recognize they're being advertised to"

- **Wojdynski & Evans 2016**, "Going Native" (*Journal of Advertising*): only **7%** (study 1) and about 17–18% (study 2) of readers identified a native ad as advertising, even with a disclosure label. [strong] https://adpr.uga.edu/2016/02/29/consumers-having-difficulty-distinguishing-between-native-advertising-and-editorial-content/amp
- **Boerman, van Reijmersdal & Neijens 2012** (*Journal of Communication*): a 3-second sponsorship disclosure on TV didn't trigger viewers' awareness that they were being persuaded, while a 6-second one did. Short, subtle disclosures are close to useless, which bears on your FTC point. [strong] https://www.researchgate.net/profile/Sophie-Boerman/publication/257143519_Sponsorship_Disclosure_Effects_of_Duration_on_Persuasion_Knowledge_and_Brand_Responses/links/59e60010458515250250c7b7/Sponsorship-Disclosure-Effects-of-Duration-on-Persuasion-Knowledge-and-Brand-Responses.pdf
- **Personalized placement works, but only when subtle:** Trifts & Aghakhani (*Journal of Marketing Communications*, about 2019). Brand placements personalized to the reader in eBooks raised recall and choice, and raised willingness to pay **only when the placement was subtle**. This supports "subtle, tasteful." ⚠ verify, abstract only. https://latam-cl.demo.elsevierpure.com/en/publications/enhancing-digital-entertainment-through-personalization-the-evolv
- **Russell 2002** (*Journal of Consumer Research*): placements that fit the plot persuade more but are remembered less. An optimizer could tune that trade-off per viewer. [strong] https://ideas.repec.org/a/oup/jconrs/v29y2002i3p306-18.html

### Counterforce: regulation

- **EU AI Act Article 50** has been in force since 2 Aug 2026. Anyone publishing AI-generated or AI-manipulated video that "would falsely appear to a person to be authentic" must disclose it at first exposure, with lighter rules for evidently artistic or fictional work. Personalized edits to real creators' faces, voices or products in the EU may well count. This is a stronger counterpart to your FTC note. ⚠ verify against the regulation text, the sources are law-firm summaries. https://www.mondaq.com/eu-ai-act-guidance-expands-ai-disclosure-rules-for-advertisers-and-pr-teams/1825496

### No good evidence found

- No peer-reviewed study of *per-viewer* dynamic product placement inside video. There's only the eBook analog above and a 2026 *Multimedia Systems* paper (Furini et al.) I couldn't read.

### Suggested additions

- **Ad timing per viewer** (Peak Points), not just ad content.
- **Sponsor reads in the creator's cloned voice and avatar,** personalized per viewer (ekoz.ai, TikTok Symphony). This is likely to come before swapping objects in the scene, because it's cheaper.
- **Shoppable everything:** every object in frame is tagged and buyable (YouTube auto-tagging).
- **Regional and price-tier swaps:** the brand of soda or car changes by country or by the viewer's inferred income.
- **Parasocial ads:** the most persuasive placement is the creator *recommending* the product, which ties to your "Will there even be creators?" section.

---

## 6. The video-making process (bonus)

- **AI slop is already a large share of feeds:** Kapwing (Oct 2025) found 21% of the first 500 Shorts served to a brand-new account were "AI slop" and 33% were "brainrot." They estimate 278 fully AI channels with 63B views. That's a new-account feed only, and the channel numbers are secondary. [moderate] https://the-decoder.com/one-in-five-youtube-shorts-shown-to-new-users-is-ai-generated-slop-study-finds/
- **Feeds made entirely of AI video:** OpenAI's Sora app (with "cameos" of real users) and Meta's Vibes feed both launched in Sept–Oct 2025. "Will humans actually film anything anymore?" is a live product question. [news] https://www.domusweb.it/en/news/gallery/2025/10/02/meta-vibes-openai-sora2-ai-video-social.html

---

## Things to double-check before citing

- Shulman et al. 2024: I couldn't access the effect sizes.
- Bailenson 2008: the 40% blend figure comes from the 2006 study, not necessarily the 2008 paper.
- Hess 1965: sources disagree on whether he used photos or drawings.
- Bruckert 2010: failed replication. Don't use it without the caveat.
- Netflix "villains beat heroes": secondary coverage only.
- YouTube expressive-speech language counts and lip-sync status change often.
- EU AI Act Article 50: law-firm summaries, not the official text.



I found supporting evidence for every subsection, plus a few findings that cut against parts of the draft. The full list is in internetvideos-evidence.md. It has about 80 sources, each with a link and a rating of how strong it is. That file is in a temporary scratch folder, so move it somewhere permanent if you want to keep it. I didn't touch draftinternetvideos.html or anything else in the repo.

Your two direct questions:

How hard is changing colors? Easy now.
Changing the whole look of a video (warmer, brighter, more saturated) is free and instant.
Recoloring one object, like a shirt or someone's hair, used to be the hard part. Meta's free SAM 2 tool now tracks any object through a video from a single click. L'Oréal's phone app has recolored hair in live video since 2018.
Runway's Aleph model (2025) can change objects, style and lighting in existing footage from a text prompt.
Does it affect viewers? Yes:
Saturated, bright colors raise arousal and pleasantness ratings, and even heart rate and skin response (Wilms & Oberfeld 2018).
People prefer images somewhat more colorful than the original, even when it looks a bit unnatural. Shifting the hue itself hurts much more. That's very close to your "brighter without tipping off" line.
On Flickr, filtered photos got 21% more views and 45% more comments. Warmth, exposure and contrast helped most.
The best enhancement differs from person to person, and one 2020 system learns a viewer's taste from 10–20 images they pick.
Has research been done on voices? Yes, and it's the strongest section:
Since ChatGPT came out, its favorite words ("delve," "meticulous") have risen in spoken language. One study covered about 280k YouTube talks, another 22M words of unscripted podcasts.
Two studies (2024, 2025) found messages tailored to the person by an AI were more persuasive than generic ones or than human debaters.
The tech for changing voices is already out: YouTube auto-dubbing keeps the creator's pitch and intonation, and YouTube's Stable Volume evens out loudness automatically.

Where the evidence pushes back on the draft:

Model writing styles disappearing. A 2025 study could tell ChatGPT, Claude, Grok, Gemini and DeepSeek apart 97% of the time, even after the text was rewritten or translated. People may stop noticing the style, but it doesn't go away.
Long videos getting shorter. Most YouTube watching in the US now happens on TVs, and the share of viewing time on 20+ minute videos went up through 2025. Pop-song intros shrinking from about 20 seconds to about 5 is a good comparison for your prediction, but you may want to address this tension.
Attractiveness. Very attractive fitness influencers got less engagement than moderately attractive ones, because they felt less relatable. This actually backs your "slightly hotter, not too noticeable" framing.

Additions I'd consider:

Making the creator's face slightly resemble the viewer's. In a 2008 study, morphing voters' own faces into candidate photos increased support, and nobody noticed. This is the most striking one.
Eye contact. FaceTime and NVIDIA already redraw your eyes to look at the camera.
Accent matching to the viewer, and per-viewer speed or silence trimming. Podcast apps already cut silences automatically.
Ad timing as well as ad content. YouTube now uses Gemini to place ads right after a video's most engaging moment.
Sponsor reads in the creator's cloned voice. Podcasts started doing this in July 2025.
The EU AI Act. Its disclosure rule for AI-altered video took effect in August 2026 and is a stronger counterweight than the FTC note.

Gaps (nothing solid found):

Whether thumbnail or video color affects views on YouTube or TikTok
Whether AI-improved voices raise engagement on a real platform
Whether a creator's attractiveness predicts their views
Per-viewer product placement inside video

A few figures I only saw in abstracts or news coverage are marked "⚠ verify" at the bottom of the file. Check those before quoting them.
