const cheerio = require('cheerio');
const Telenode = require('telenode-js');
const fs = require('fs');
const config = require('./config.json');
const path = require('path');
fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true }); // create once

const safeName = (s) => s.replace(/[\\/:*?"<>|]/g, '_').trim();
const getYad2Response = async (url) => {
    const requestOptions = {
        method: 'GET',
        redirect: 'follow'
    };
    try {
        const res = await fetch(url, requestOptions)
        return await res.text()
    } catch (err) {
        console.log(err)
    }
}

const scrapeItemsAndExtractImgUrls = async (url) => {
    const yad2Html = await getYad2Response(url);
    if (!yad2Html) {
        throw new Error("Could not get Yad2 response");
    }
    const $ = cheerio.load(yad2Html);
    const title = $("title")
    const titleText = title.first().text();
    if (titleText === "ShieldSquare Captcha") {
        throw new Error("Bot detection");
    }
    const $feedItems = $(".feeditem").find(".pic");
    if (!$feedItems) {
        throw new Error("Could not find feed items");
    }
    const imageUrls = []
    $feedItems.each((_, elm) => {
        const imgSrc = $(elm).find("img").attr('src');
        if (imgSrc) {
            imageUrls.push(imgSrc)
        }
    })
    return imageUrls;
}

const checkIfHasNewItem = async (imgUrls, topic) => {
  const filePath = path.join(__dirname, 'data', `${safeName(topic)}.json`);
  let savedUrls = [];

  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, '[]'); // fresh file per topic
  } else {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      savedUrls = JSON.parse(raw);
    } catch (e) {
      console.log(e);
      throw new Error(`Could not read / create ${filePath}`);
    }
  }

  let shouldUpdateFile = false;
  savedUrls = savedUrls.filter(u => {
    shouldUpdateFile = true;
    return imgUrls.includes(u);
  });

  const newItems = [];
  for (const url of imgUrls) {
    if (!savedUrls.includes(url)) {
      savedUrls.push(url);
      newItems.push(url);
      shouldUpdateFile = true;
    }
  }

  if (shouldUpdateFile) {
    fs.writeFileSync(filePath, JSON.stringify(savedUrls, null, 2));
    await createPushFlagForWorkflow();
  }
  return newItems;
};

const createPushFlagForWorkflow = () => {
    fs.writeFileSync("push_me", "")
}

const scrape = async (topic, url) => {
    const apiToken = process.env.API_TOKEN || config.telegramApiToken;
    const chatId = process.env.CHAT_ID || config.chatId;
    const telenode = new Telenode({apiToken})
    try {
        await telenode.sendTextMessage(`Starting scanning ${topic} on link:\n${url}`, chatId)
        const scrapeImgResults = await scrapeItemsAndExtractImgUrls(url);
        const newItems = await checkIfHasNewItem(scrapeImgResults, topic);
        if (newItems.length > 0) {
            const newItemsJoined = newItems.join("\n----------\n");
            const msg = `${newItems.length} new items:\n${newItemsJoined}`
            await telenode.sendTextMessage(msg, chatId);
        } else {
            await telenode.sendTextMessage("No new items were added", chatId);
        }
    } catch (e) {
        let errMsg = e?.message || "";
        if (errMsg) {
            errMsg = `Error: ${errMsg}`
        }
        await telenode.sendTextMessage(`Scan workflow failed... 😥\n${errMsg}`, chatId)
        throw new Error(e)
    }
}

const program = async () => {
    await Promise.all(config.projects.filter(project => {
        if (project.disabled) {
            console.log(`Topic "${project.topic}" is disabled. Skipping.`);
        }
        return !project.disabled;
    }).map(async project => {
        await scrape(project.topic, project.url)
    }))
};

program();
