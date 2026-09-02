const Handlebars = require('handlebars');
Handlebars.registerHelper('crop_history', function(n) {
    return `{{crop_history_${n}}}`;
});
let template = Handlebars.compile("Testing {{crop_history 5}} and {{crop_history 10}}", {noEscape: true});
console.log(template({}));
