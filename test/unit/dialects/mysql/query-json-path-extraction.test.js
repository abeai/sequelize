'use strict';

const chai = require('chai');

const expect = chai.expect;
const Support = require('../../support');

const dialect = Support.getTestDialect();
const { MySqlQueryGenerator: QueryGenerator } = require('@sequelize/core/_non-semver-use-at-your-own-risk_/dialects/mysql/query-generator.js');

if (dialect === 'mysql') {
  describe('[MYSQL Specific] jsonPathExtractionQuery', () => {
    let queryGenerator;
    beforeEach(function () {
      queryGenerator = new QueryGenerator({
        sequelize: this.sequelize,
        _dialect: this.sequelize.dialect,
      });
    });

    it('should handle isJson parameter true', async () => {
      expect(queryGenerator.jsonPathExtractionQuery('profile', 'id', true)).to.equal('json_unquote(json_extract(`profile`,\'$.\\"id\\"\'))');
    });

    it('should use default handling if isJson is false', async () => {
      expect(queryGenerator.jsonPathExtractionQuery('profile', 'id', false)).to.equal('json_unquote(json_extract(`profile`,\'$.\\"id\\"\'))');
    });

    it('Should use default handling if isJson is not passed', async () => {
      expect(queryGenerator.jsonPathExtractionQuery('profile', 'id')).to.equal('json_unquote(json_extract(`profile`,\'$.\\"id\\"\'))');
    });
  });
}
