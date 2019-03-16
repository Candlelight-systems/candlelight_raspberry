const path = require('path');
const fs = require('fs');
const jsonPath = path.join(__dirname, './recipes.json');
const recipes = require(jsonPath);
console.log(recipes);
module.exports = {
  recipes: recipes,
  saveRecipes: () => {
    fs.writeFileSync(jsonPath, JSON.stringify(recipes, undefined, '\t'));
  }
};
